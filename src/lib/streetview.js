/*
 * Google Street View Static API helper.
 *
 * Used to give a brand-new listing a default photo from just its address. Two entry points:
 *   - getStreetViewShot()      → resolves availability + a live Static API image URL (used by
 *                                the /api/streetview/preview route for the add-listing form).
 *   - fetchAndStoreStreetView() → downloads that image once and stores a permanent copy in R2,
 *                                inserting a listing_images row tagged source='street_view'
 *                                (used server-side by /api/addListing and /api/reviewReferral).
 *
 * Orientation: we query Street View by the textual ADDRESS (not raw lat/lng) so Google snaps to
 * the panorama nearest the building, then we compute the camera heading from that panorama toward
 * the building's coordinates. This points the camera at the correct side of the street instead of
 * whatever direction a bare coordinate lookup happens to default to.
 *
 * Key: prefer GOOGLE_MAPS_SERVER_KEY (a server-only, unrestricted/IP-restricted key) and fall
 * back to NEXT_PUBLIC_GOOGLE_MAPS_KEY. The public key is typically HTTP-referer restricted for the
 * browser, which causes Google to DENY these server-side calls (no Referer header) — so a separate
 * server key is required for this to work in production.
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/lib/r2";

const META_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";
const IMG_URL = "https://maps.googleapis.com/maps/api/streetview";
const IMG_SIZE = "640x640";

// Mirror /api/upload's bucket selection: explicit "prod" or production NODE_ENV → prod bucket.
function isProdBucket(db) {
  if (db === "prod") return true;
  if (!db && process.env.NODE_ENV === "production") return true;
  return false;
}
function getBucket(db) {
  return isProdBucket(db)
    ? (process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME)
    : process.env.R2_BUCKET_NAME;
}
function getPublicBase(db) {
  return isProdBucket(db)
    ? (process.env.R2_PUBLIC_BASE_URL_prod || process.env.R2_PUBLIC_BASE_URL)
    : process.env.R2_PUBLIC_BASE_URL;
}

// "1173 Moorlands Dr, St. Louis, MO 63117" → "1173-moorlands" (matches /api/upload's folder slug)
function addressToFolderSlug(address) {
  const street = (address || "").split(",")[0].trim();
  return street
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .join("-");
}

// Initial compass bearing (degrees, 0=N) from point 1 toward point 2.
function bearing(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Resolve a Street View shot for an address.
 * Returns { available, url, panoLat, panoLng, heading } — `url` is a live Static API URL
 * (image bytes), only set when available. Never throws; returns { available: false } on error.
 */
export async function getStreetViewShot({ address, lat, lng }) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  if (!key) {
    console.warn("[streetview] no Google Maps key set (GOOGLE_MAPS_SERVER_KEY / NEXT_PUBLIC_GOOGLE_MAPS_KEY)");
    return { available: false };
  }

  // Prefer the textual address; fall back to coordinates if we only have those.
  const locationParam =
    address && String(address).trim()
      ? encodeURIComponent(String(address).trim())
      : lat != null && lng != null
      ? `${lat},${lng}`
      : null;
  if (!locationParam) return { available: false };

  try {
    // Free metadata check — confirms imagery exists and gives the panorama's position.
    const metaRes = await fetch(
      `${META_URL}?location=${locationParam}&source=outdoor&key=${key}`
    );
    const meta = await metaRes.json();
    if (meta?.status !== "OK") {
      // Surface the reason instead of failing silently. REQUEST_DENIED here almost always means
      // the key is HTTP-referer restricted and rejects this server-side (refererless) call.
      console.warn(
        `[streetview] metadata not OK — status=${meta?.status || "unknown"}` +
          (meta?.error_message ? ` (${meta.error_message})` : "")
      );
      return { available: false };
    }

    const panoLat = meta?.location?.lat ?? null;
    const panoLng = meta?.location?.lng ?? null;

    // Point the camera from the panorama toward the building coordinates so we capture the
    // correct side of the street. Only possible when we have both points.
    const params = new URLSearchParams({
      size: IMG_SIZE,
      location: decodeURIComponent(locationParam),
      fov: "80",
      pitch: "0",
      source: "outdoor",
      return_error_code: "true",
      key,
    });
    if (panoLat != null && panoLng != null && lat != null && lng != null) {
      params.set("heading", String(Math.round(bearing(panoLat, panoLng, lat, lng))));
    }

    return {
      available: true,
      url: `${IMG_URL}?${params.toString()}`,
      panoLat,
      panoLng,
      heading: params.get("heading") ? Number(params.get("heading")) : null,
    };
  } catch (err) {
    console.error("[streetview] lookup failed:", err?.message);
    return { available: false };
  }
}

/**
 * Fetch a Street View image for a listing and store it permanently in R2, recording a
 * listing_images row tagged source='street_view'. Returns the public R2 URL, or null if no
 * imagery / on any failure (callers must treat this as best-effort and never block on it).
 *
 * @param {object}  args
 * @param {object}  args.supabase    server Supabase client (service role) to insert with
 * @param {string}  args.listingId
 * @param {string}  args.address
 * @param {number}  args.lat
 * @param {number}  args.lng
 * @param {string} [args.db]         "prod" | "dev" — R2 bucket target (defaults via NODE_ENV)
 * @param {number} [args.sortOrder]  defaults to 0 (cover photo)
 */
export async function fetchAndStoreStreetView({
  supabase,
  listingId,
  address,
  lat,
  lng,
  db = null,
  sortOrder = 0,
}) {
  try {
    if (!listingId) return null;
    const shot = await getStreetViewShot({ address, lat, lng });
    if (!shot.available) return null;

    const imgRes = await fetch(shot.url);
    if (!imgRes.ok) {
      console.warn("[streetview] image fetch returned", imgRes.status);
      return null;
    }
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    const bucket = getBucket(db);
    const publicBase = getPublicBase(db);
    const folder = addressToFolderSlug(address);
    const k = `${folder}/${crypto.randomUUID()}-streetview.jpg`;

    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: k,
        Body: buffer,
        ContentType: "image/jpeg",
      })
    );
    const publicUrl = `${publicBase}/${k}`;

    const { error } = await supabase.from("listing_images").insert({
      listing_id: listingId,
      url: publicUrl,
      sort_order: sortOrder,
      source: "street_view",
    });
    if (error) {
      console.error("[streetview] DB insert failed:", error.message);
      return null;
    }
    return publicUrl;
  } catch (err) {
    console.error("[streetview] fetchAndStore failed:", err?.message);
    return null;
  }
}
