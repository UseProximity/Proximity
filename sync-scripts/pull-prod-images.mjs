/**
 * pull-prod-images.mjs
 * Downloads listing images from the prod database into local folders.
 *
 * What it syncs:
 *   MongoDB prod listings (listing.images[] URLs)
 *   → public/listing-pics/{address-slug}/ on disk
 *   Existing files are skipped (duplicate-safe). Use this to recover or
 *   back up prod images locally before re-uploading to R2.
 *
 * Backend touched:
 *   - MongoDB prod cluster (MONGO_URI_PROD) — read-only
 *   - public/listing-pics/ on disk          — writes image files
 *
 * Usage:
 *   node sync-scripts/pull-prod-images.mjs            # download all missing images
 *   node sync-scripts/pull-prod-images.mjs --dry-run  # preview without downloading
 */

import { MongoClient } from "mongodb";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import { createWriteStream } from "fs";
import https from "https";
import http from "http";

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
const MONGO_URI = envVars.MONGO_URI_PROD;
const LISTINGS_COLLECTION = envVars.LISTINGS_COLLECTION || "listings";
const PICS_DIR = resolve(process.cwd(), "public/listing-pics");

const NOISE_WORDS = /\b(pictures?|photos?|pics?|images?)\b/gi;
const STREET_SUFFIXES =
  /\b(ave\.?|avenue|st\.?|street|blvd\.?|boulevard|rd\.?|road|dr\.?|drive|ln\.?|lane|way|ct\.?|court|pl\.?|place|pkwy\.?|parkway|terr?\.?|terrace|cir\.?|circle|loop|trl\.?|trail)\s*$/i;

function toAddressSlug(address) {
  return address
    .split(",")[0]
    .replace(NOISE_WORDS, "")
    .replace(STREET_SUFFIXES, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/").filter(Boolean);
    const raw = decodeURIComponent(parts[parts.length - 1] || "image");
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return safe || "image.jpg";
  } catch {
    return "image.jpg";
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file = createWriteStream(dest);
    proto
      .get(url, { timeout: 30000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      })
      .on("error", (err) => { file.close(); reject(err); });
  });
}

async function main() {
  console.log(`Connecting to prod DB${isDryRun ? " [DRY RUN]" : ""}...\n`);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const listings = await db
    .collection(LISTINGS_COLLECTION)
    .find({ images: { $exists: true, $not: { $size: 0 } } }, { projection: { _id: 1, address: 1, images: 1 } })
    .toArray();

  console.log(`Found ${listings.length} listings with images.\n`);

  let downloaded = 0, skipped = 0, failed = 0;

  for (const listing of listings) {
    if (!listing.address) continue;
    const slug = toAddressSlug(listing.address);
    const folderPath = join(PICS_DIR, slug);
    const images = (listing.images || []).filter(Boolean);
    if (images.length === 0) continue;

    console.log(`\n${slug} (${images.length} image${images.length !== 1 ? "s" : ""})`);
    console.log(`  address: "${listing.address}"`);

    if (!isDryRun) mkdirSync(folderPath, { recursive: true });

    for (const url of images) {
      const filename = sanitizeFilename(url);
      const dest = join(folderPath, filename);

      if (existsSync(dest)) {
        console.log(`  [skip] ${filename}`);
        skipped++;
        continue;
      }

      if (isDryRun) {
        console.log(`  [dry-run] ${filename}`);
        downloaded++;
        continue;
      }

      try {
        await downloadFile(url, dest);
        console.log(`  ✓ ${filename}`);
        downloaded++;
      } catch (err) {
        console.log(`  ✗ FAILED ${filename} — ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\nDone. ${downloaded} downloaded, ${skipped} skipped, ${failed} failed.`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
