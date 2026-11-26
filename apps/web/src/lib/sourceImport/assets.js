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
import { fetchAssetResponse, readAssetCapped, renderPage } from "@/lib/listingDraft/fetchSite";

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

async function store(raw, type, { kind, slug }) {
  if (raw.length < (kind === "floor-plan" ? MIN_PLAN_BYTES : MIN_PHOTO_BYTES)) return null;
  const { buffer, type: finalType } = kind === "floor-plan" ? { buffer: raw, type } : await shrink(raw, type);
  const ext = EXT[finalType] ?? "jpg";
  const folder = kind === "floor-plan" ? "floor-plans" : kind === "unit-photo" ? "unit-photos" : `listings/${slug}`;
  const key = `${folder}/${crypto.randomUUID()}.${ext}`;
  await r2.send(new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: buffer, ContentType: finalType }));
  return `${getPublicBaseUrl()}/${key}`;
}

/* One plain copy. { stored } on success, { blocked } when the host refused us. */
async function tryCopy(url, opts) {
  try {
    const res = await fetchAssetResponse(url);
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("image/") || type === "image/svg+xml") {
      res.body?.cancel?.().catch?.(() => {});
      return {};
    }
    const raw = await readAssetCapped(res, MAX_BYTES);
    if (!raw) return {};
    return { stored: await store(raw, type, opts) };
  } catch (err) {
    console.log(`[source-import] could not copy ${url.slice(0, 100)}: ${err?.message ?? err}`);
    return { blocked: /http_(401|403|429)/.test(String(err?.message ?? "")) };
  }
}

/*
 * Photos a host refuses to hand to a server (Apartments.com's image CDN
 * answers every server fetch 403, whatever the headers, and Firecrawl will
 * not run scripts on an image). A browser on the host's own site still
 * shows them, so: render the site's home page once, swap the page for one
 * photo at a time, and screenshot it. One credit for up to SHOT_BATCH
 * photos. Returns Map(url -> PNG buffer).
 */
const SHOT_BATCH = 10;
async function screenshotImages(urls) {
  const out = new Map();
  let origin;
  try {
    const host = new URL(urls[0]).hostname.split(".");
    origin = `https://www.${host.slice(-2).join(".")}/`;
  } catch {
    return out;
  }
  const show = (u) =>
    `(async () => { document.documentElement.innerHTML = '<head><style>html,body{margin:0;padding:0;background:#fff}img{display:block;width:100vw;height:auto}</style></head><body></body>'; const i = new Image(); i.src = ${JSON.stringify(u)}; document.body.appendChild(i); await new Promise((r) => { i.onload = r; i.onerror = r; setTimeout(r, 8000); }); return JSON.stringify({ w: i.naturalWidth, h: i.naturalHeight }); })()`;
  for (let i = 0; i < urls.length; i += SHOT_BATCH) {
    const batch = urls.slice(i, i + SHOT_BATCH);
    const r = await renderPage(origin, { actions: batch.flatMap((u) => [{ type: "executeJavascript", script: show(u) }, { type: "screenshot", fullPage: true }]) });
    if (!r) continue;
    await Promise.all(
      batch.map(async (u, j) => {
        let size = null;
        try {
          size = JSON.parse(r.returns?.[j] ?? "null");
        } catch {
          /* unknown */
        }
        // A photo that did not load would be a blank white page.
        if (!size?.w || !r.screenshots?.[j]) return;
        try {
          const shot = await fetch(r.screenshots[j], { signal: AbortSignal.timeout(30000) });
          if (shot.ok) out.set(u, Buffer.from(await shot.arrayBuffer()));
        } catch {
          /* this one stays missing */
        }
      })
    );
  }
  console.log(`[source-import] screenshot rescue: ${out.size} of ${urls.length} blocked photos recovered from ${origin}`);
  return out;
}

export async function copyRemoteImage(url, opts = {}) {
  const o = { kind: "photo", slug: "import", ...opts };
  const first = await tryCopy(url, o);
  if (first.stored || !first.blocked) return first.stored ?? null;
  const shots = await screenshotImages([url]);
  const png = shots.get(url);
  return png ? store(png, "image/png", o).catch(() => null) : null;
}

export async function copyRemoteImages(urls, opts) {
  const o = { kind: "photo", slug: "import", ...opts };
  const out = new Array(urls.length).fill(null);
  const blocked = [];
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= urls.length) return;
      const r = await tryCopy(urls[i], o);
      out[i] = r.stored ?? null;
      if (r.blocked) blocked.push(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  if (blocked.length) {
    const shots = await screenshotImages(blocked.map((i) => urls[i]));
    for (const i of blocked) {
      const png = shots.get(urls[i]);
      if (png) out[i] = await store(png, "image/png", o).catch(() => null);
    }
  }
  const ok = out.filter(Boolean).length;
  console.log(`[source-import] photos: ${ok} of ${urls.length} copied${opts?.slug ? ` for ${opts.slug}` : ""}${ok < urls.length ? ` (first miss: ${urls[out.findIndex((x) => !x)]?.slice(0, 100)})` : ""}`);
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
