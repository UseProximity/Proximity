/**
 * Syncs images from Cloudflare R2 to MongoDB listing records.
 *
 * R2 folders are named by address slug (e.g. "7515-forsyth-blvd").
 * This script matches each folder to a listing by slugifying the listing's
 * street address, then replaces listing.images with the R2 public URLs.
 *
 * Usage:
 *   node scripts/sync-r2-images.mjs             # sync to dev DB
 *   node scripts/sync-r2-images.mjs --prod       # sync to prod DB
 *   node scripts/sync-r2-images.mjs --dry-run    # preview without writing
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
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
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

// Trailing words stripped before slugifying (same logic as upload-images.mjs).
const NOISE_WORDS = /\b(pictures?|photos?|pics?|images?)\b/gi;
const STREET_SUFFIXES =
  /\b(ave\.?|avenue|st\.?|street|blvd\.?|boulevard|rd\.?|road|dr\.?|drive|ln\.?|lane|way|ct\.?|court|pl\.?|place|pkwy\.?|parkway|terr?\.?|terrace|cir\.?|circle|loop|trl\.?|trail)\s*$/i;

/**
 * Convert an address string to a canonical slug.
 *   "6042 Kingsbury Ave, St. Louis, MO" → "6042-kingsbury"
 *   "7515 Forsyth Blvd, Clayton, MO"   → "7515-forsyth"
 */
function addressToSlug(address) {
  return address
    .split(",")[0]
    .replace(NOISE_WORDS, "")
    .replace(STREET_SUFFIXES, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

  // Build slug → listing map
  const slugMap = new Map();
  for (const listing of allListings) {
    if (listing.address) {
      const slug = addressToSlug(listing.address);
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

  for (const prefix of r2Folders) {
    const slug = prefix.replace(/\/$/, ""); // strip trailing slash
    const listing = slugMap.get(slug);

    if (!listing) {
      console.log(`[no match] ${slug}`);
      unmatched++;
      continue;
    }

    const keys = await listR2Objects(prefix);
    const urls = keys.map((key) => `${R2_PUBLIC_BASE_URL}/${key}`);
    matched++;

    if (isDryRun) {
      console.log(
        `[dry-run]  ${slug} → "${listing.address}" (${urls.length} image${urls.length !== 1 ? "s" : ""})`
      );
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
    `\nDone. ${matched} matched, ${unmatched} unmatched${isDryRun ? "" : `, ${updated} updated`}.`
  );

  await mongoClient.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
