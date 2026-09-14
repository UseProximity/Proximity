/*
 * One-off backfill: give every imageless PRODUCTION listing a default Google Street View photo.
 *
 * For each non-deleted listing that has zero listing_images rows, this:
 *   1. Confirms Street View imagery exists for the address (free metadata endpoint).
 *   2. Computes a camera heading from the nearest panorama toward the building coordinates so the
 *      shot faces the correct side of the street (mirrors src/lib/streetview.js).
 *   3. Downloads the 640x640 image and stores it in the PROD R2 bucket.
 *   4. Inserts a listing_images row at sort_order 0 tagged source='street_view'.
 *
 * Idempotent: only touches listings that still have no images, so it's safe to re-run.
 *
 * Usage:
 *   node scripts/backfill-streetview-images.js          # dry run (lists what it would do)
 *   node scripts/backfill-streetview-images.js --apply   # actually write to R2 + DB
 */
require("dotenv").config({ path: ".env.local" });

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const APPLY = process.argv.includes("--apply");

const SUPABASE_URL = process.env.PROD_SUPABASE_URL;
const SUPABASE_KEY = process.env.PROD_SUPABASE_SERVICE_KEY;
const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME;
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_BASE_URL_prod || process.env.R2_PUBLIC_BASE_URL;

for (const [k, v] of Object.entries({
  PROD_SUPABASE_URL: SUPABASE_URL,
  PROD_SUPABASE_SERVICE_KEY: SUPABASE_KEY,
  NEXT_PUBLIC_GOOGLE_MAPS_KEY: GOOGLE_KEY,
  "R2 bucket (prod)": R2_BUCKET,
  "R2 public base (prod)": R2_PUBLIC_BASE,
})) {
  if (!v) {
    console.error(`Missing required env: ${k}`);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const META_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";
const IMG_URL = "https://maps.googleapis.com/maps/api/streetview";

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

function bearing(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

async function getStreetViewShot({ address, lat, lng }) {
  const locationParam =
    address && String(address).trim()
      ? encodeURIComponent(String(address).trim())
      : lat != null && lng != null
      ? `${lat},${lng}`
      : null;
  if (!locationParam) return { available: false };

  const metaRes = await fetch(`${META_URL}?location=${locationParam}&source=outdoor&key=${GOOGLE_KEY}`);
  const meta = await metaRes.json();
  if (meta?.status !== "OK") return { available: false, status: meta?.status };

  const panoLat = meta?.location?.lat ?? null;
  const panoLng = meta?.location?.lng ?? null;

  const params = new URLSearchParams({
    size: "640x640",
    location: decodeURIComponent(locationParam),
    fov: "80",
    pitch: "0",
    source: "outdoor",
    return_error_code: "true",
    key: GOOGLE_KEY,
  });
  if (panoLat != null && panoLng != null && lat != null && lng != null) {
    params.set("heading", String(Math.round(bearing(panoLat, panoLng, lat, lng))));
  }
  return { available: true, url: `${IMG_URL}?${params.toString()}`, heading: params.get("heading") };
}

async function backfillListing(listing) {
  const lat = listing.latitude != null ? Number(listing.latitude) : null;
  const lng = listing.longitude != null ? Number(listing.longitude) : null;

  const shot = await getStreetViewShot({ address: listing.address, lat, lng });
  if (!shot.available) {
    console.log(`  ⏭  no imagery (status=${shot.status || "?"}) — skipping`);
    return "skipped";
  }
  console.log(`  📷 imagery OK (heading=${shot.heading ?? "default"})`);

  if (!APPLY) {
    console.log("     [dry run] would download + upload + insert");
    return "would-apply";
  }

  const imgRes = await fetch(shot.url);
  if (!imgRes.ok) {
    console.log(`  ⚠️  image fetch ${imgRes.status} — skipping`);
    return "skipped";
  }
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const key = `${addressToFolderSlug(listing.address)}/${crypto.randomUUID()}-streetview.jpg`;

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
    })
  );
  const publicUrl = `${R2_PUBLIC_BASE}/${key}`;

  const { error } = await supabase.from("listing_images").insert({
    listing_id: listing.id,
    url: publicUrl,
    sort_order: 0,
    source: "street_view",
  });
  if (error) {
    console.log(`  ❌ DB insert failed: ${error.message}`);
    return "error";
  }
  console.log(`  ✅ stored ${publicUrl}`);
  return "done";
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writing to prod)" : "DRY RUN"}  bucket=${R2_BUCKET}`);

  // Listings with no images. Pull listing_images(listing_id) and diff in JS. PostgREST caps a
  // select at 1000 rows, so BOTH queries page through with .range() — otherwise truncation makes
  // listings whose image rows fall past page 1 look imageless and get a wrong cover photo.
  const fetchAllRows = async (table, select, filterDeleted) => {
    const pageSize = 1000;
    let from = 0;
    const all = [];
    for (;;) {
      let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
      if (filterDeleted) q = q.is("deleted_at", null);
      const { data, error } = await q;
      if (error) throw new Error(`fetch ${table}: ${error.message}`);
      all.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return all;
  };

  const listings = await fetchAllRows("listings", "id, address, latitude, longitude", true);
  const imgs = await fetchAllRows("listing_images", "listing_id", false);
  const withImages = new Set(imgs.map((r) => r.listing_id));

  const imageless = (listings || []).filter((l) => !withImages.has(l.id));
  console.log(`Imageless listings: ${imageless.length}\n`);

  const tally = {};
  for (const l of imageless) {
    console.log(`• ${l.address} (${l.id})`);
    const result = await backfillListing(l);
    tally[result] = (tally[result] || 0) + 1;
  }

  console.log(`\nSummary:`, tally);
  if (!APPLY) console.log("Dry run only — re-run with --apply to write.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
