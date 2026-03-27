/**
 * sync-r2-images.mjs
 * Syncs Cloudflare R2 image folders to MongoDB listing records.
 *
 * What it syncs:
 *   Cloudflare R2 bucket (top-level folder prefixes by address slug)
 *   → MongoDB listings collection (listing.images[] field)
 *   Matches R2 folders to listings by slugified street address.
 *   Files named "main.*" are pinned as images[0] (cover photo).
 *   Listings whose images array is already up to date are skipped.
 *
 * Backend touched:
 *   - Cloudflare R2 bucket  (read-only — lists folders/keys)
 *   - MongoDB listings collection (writes listing.images[])
 *     Dev:  MONGO_URI       → "listings" collection in dev cluster
 *     Prod: MONGO_URI_PROD  → "listings" collection in prod cluster
 *
 * Usage:
 *   node sync-scripts/sync-r2-images.mjs             # sync to dev DB
 *   node sync-scripts/sync-r2-images.mjs --prod       # sync to prod DB
 *   node sync-scripts/sync-r2-images.mjs --dry-run    # preview matches, no writes
 *   node sync-scripts/sync-r2-images.mjs --prod --dry-run
 */

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local");
const envVars = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      const raw = l.slice(i + 1).trim().replace(/^["']([^"']*)["'].*$/, "$1").replace(/\s+#.*$/, "");
      return [l.slice(0, i).trim(), raw];
    })
);

const isDryRun = process.argv.includes("--dry-run");
const isProd = process.argv.includes("--prod");

const MONGO_URI = isProd ? envVars.MONGO_URI_PROD : envVars.MONGO_URI;
const LISTINGS_COLLECTION = envVars.LISTINGS_COLLECTION || "listings";
const R2_PUBLIC_BASE_URL = isProd
  ? (envVars.R2_PUBLIC_BASE_URL_prod || envVars.R2_PUBLIC_BASE_URL)
  : envVars.R2_PUBLIC_BASE_URL;
const BUCKET = envVars.R2_BUCKET_NAME;

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${envVars.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: envVars.R2_ACCESS_KEY_ID,
    secretAccessKey: envVars.R2_SECRET_ACCESS_KEY,
  },
});

// Words stripped before generating the loose address key.
const NOISE_WORDS = /\b(pictures?|photos?|pics?|images?)\b/gi;

/**
 * Convert an address-like string to a loose canonical key.
 *   "6042 Kingsbury Ave, St. Louis, MO"            → "6042-kingsbury"
 *   "6651 Kingsbury Blvd\nAPT 1W, Saint Louis..."  → "6651-kingsbury"
 *   "7515-forsyth-blvd"                            → "7515-forsyth"
 */
function toAddressMatchKey(addressLike) {
  const tokens = addressLike
    .replace(NOISE_WORDS, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];

  // Skip a leading building name (e.g. "LOCAL on Delmar, 6650 Delmar Blvd")
  // by jumping to the first purely numeric token (the street number).
  const numIdx = tokens.findIndex((t) => /^\d+$/.test(t));
  const start = numIdx >= 0 ? numIdx : 0;
  return tokens.slice(start, start + 2).join("-");
}

/** List all top-level folder prefixes in the R2 bucket. */
async function listR2Folders() {
  const folders = [];
  let continuationToken;
  do {
    const res = await r2.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Delimiter: "/",
        ContinuationToken: continuationToken,
      })
    );
    for (const prefix of res.CommonPrefixes || []) {
      folders.push(prefix.Prefix); // e.g. "7515-forsyth-blvd/"
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return folders;
}

/** List all object keys within a given R2 folder prefix. */
async function listR2Objects(prefix) {
  const keys = [];
  let continuationToken;
  do {
    const res = await r2.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of res.Contents || []) {
      // Skip folder placeholder objects (zero-byte keys ending with /)
      if (!obj.Key.endsWith("/") && obj.Size > 0) {
        keys.push(obj.Key);
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function main() {
  console.log(`Target: ${isProd ? "PROD" : "DEV"} database${isDryRun ? " [DRY RUN]" : ""}\n`);

  // Connect to MongoDB
  const mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  const db = mongoClient.db();
  const listings = db.collection(LISTINGS_COLLECTION);

  // Load all listings (only fields we need)
  const allListings = await listings
    .find({}, { projection: { _id: 1, address: 1, images: 1 } })
    .toArray();

  // Build loose address key → listing map
  const slugMap = new Map();
  for (const listing of allListings) {
    if (listing.address) {
      const slug = toAddressMatchKey(listing.address);
      slugMap.set(slug, listing);
    }
  }

  // List all R2 folders
  const r2Folders = await listR2Folders();

  if (r2Folders.length === 0) {
    console.log("No folders found in R2 bucket.");
    await mongoClient.close();
    return;
  }

  let matched = 0;
  let unmatched = 0;
  let updated = 0;
  let skipped = 0;

  for (const prefix of r2Folders) {
    const slug = prefix.replace(/\/$/, ""); // strip trailing slash
    const matchKey = toAddressMatchKey(slug);
    const listing = slugMap.get(matchKey);

    if (!listing) {
      console.log(`[no match] ${slug}`);
      unmatched++;
      continue;
    }

    const keys = await listR2Objects(prefix);
    // Put any file named "main.*" first, rest stay in alphabetical order
    const mainKey = keys.find((k) => /\/main\.[^/]+$/.test(k));
    const sortedKeys = mainKey ? [mainKey, ...keys.filter((k) => k !== mainKey)] : keys;
    const urls = sortedKeys.map((key) => {
      const encodedKey = key.split("/").map(encodeURIComponent).join("/");
      return `${R2_PUBLIC_BASE_URL}/${encodedKey}`;
    });
    matched++;

    if (isDryRun) {
      console.log(
        `[dry-run]  ${slug} → "${listing.address}" (${urls.length} image${urls.length !== 1 ? "s" : ""})`
      );
      continue;
    }

    const existing = listing.images || [];
    const unchanged =
      existing.length === urls.length && urls.every((u, i) => u === existing[i]);
    if (unchanged) {
      console.log(`[skip]     ${slug} → "${listing.address}" (no change)`);
      skipped++;
      continue;
    }

    await listings.updateOne(
      { _id: listing._id },
      { $set: { images: urls } }
    );
    console.log(
      `[updated]  ${slug} → "${listing.address}" (${urls.length} image${urls.length !== 1 ? "s" : ""})`
    );
    updated++;
  }

  console.log(
    `\nDone. ${matched} matched, ${unmatched} unmatched${isDryRun ? "" : `, ${updated} updated, ${skipped} skipped (no change)`}.`
  );

  await mongoClient.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
