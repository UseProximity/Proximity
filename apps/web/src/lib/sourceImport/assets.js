/*
 * Copy a photo or floor plan off a landlord's website into our R2 bucket.
 *
 * The browser used to do this through an image proxy and the normal upload
 * path. The import now runs in the background with nobody's browser open, so
 * the server fetches the asset itself (same SSRF guard as every other fetch of
 * a landlord URL), caps it, and puts it in the bucket the way /api/upload does.
 * Returns the public URL, or null for anything that is not a usable image:
 * a photo we could not copy is a photo the landlord adds later, never a failed
 * import.
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2, getBucket, getPublicBaseUrl } from "@/lib/r2";
import { fetchAssetResponse, readAssetCapped } from "@/lib/listingDraft/fetchSite";

const MAX_BYTES = 8 * 1024 * 1024;
// Icons and thumbnails, not photos. Floor plan diagrams can be small PNGs,
// so the floor is lower for those.
const MIN_PHOTO_BYTES = 15000;
const MIN_PLAN_BYTES = 3000;
const CONCURRENCY = 4;

const EXT = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

let sharpLoader = null;
async function getSharp() {
  if (sharpLoader === null) {
    sharpLoader = import("sharp").then((m) => m.default ?? m).catch(() => false);
  }
  return sharpLoader;
}

/*
 * Resize and recompress the way the browser's compressImage does, when sharp
 * is installed; otherwise store the original. A 6MB CDN original is worth
 * shrinking: it is what the listing page will serve.
 */
async function shrink(buffer, type) {
  const sharp = await getSharp();
  if (!sharp || type === "image/gif") return { buffer, type };
  try {
    const out = await sharp(buffer).rotate().resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return { buffer: out, type: "image/jpeg" };
  } catch {
    return { buffer, type };
  }
}

export async function copyRemoteImage(url, { kind = "photo", slug = "import" } = {}) {
  try {
    const res = await fetchAssetResponse(url);
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("image/") || type === "image/svg+xml") {
      res.body?.cancel?.().catch?.(() => {});
      return null;
    }
    const raw = await readAssetCapped(res, MAX_BYTES);
    if (!raw) return null;
    if (raw.length < (kind === "floor-plan" ? MIN_PLAN_BYTES : MIN_PHOTO_BYTES)) return null;

    const { buffer, type: finalType } = kind === "floor-plan" ? { buffer: raw, type } : await shrink(raw, type);
    const ext = EXT[finalType] ?? "jpg";
    const folder = kind === "floor-plan" ? "floor-plans" : kind === "unit-photo" ? "unit-photos" : `listings/${slug}`;
    const key = `${folder}/${crypto.randomUUID()}.${ext}`;
    await r2.send(new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: buffer, ContentType: finalType }));
    return `${getPublicBaseUrl()}/${key}`;
  } catch (err) {
    console.log(`[source-import] could not copy ${url.slice(0, 100)}: ${err?.message ?? err}`);
    return null;
  }
}

/* Copy many, a few at a time, keeping the site's order. Drops failures. */
export async function copyRemoteImages(urls, opts) {
  const out = new Array(urls.length).fill(null);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= urls.length) return;
      out[i] = await copyRemoteImage(urls[i], opts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return urls.map((url, i) => ({ url, stored: out[i] })).filter((r) => r.stored);
}

// "1173 Moorlands Dr, St. Louis, MO 63117" -> "1173-moorlands", like /api/upload.
export function addressSlug(address) {
  const street = (address || "").split(",")[0].trim();
  return (
    street
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((t) => t.replace(/[^a-z0-9]/g, ""))
      .filter(Boolean)
      .join("-") || "import"
  );
}
