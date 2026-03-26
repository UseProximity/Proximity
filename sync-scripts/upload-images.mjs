/**
 * upload-images.mjs
 * Uploads listing images from local folders to Cloudflare R2.
 *
 * What it syncs:
 *   public/listing-pics/{address-slug}/*.jpg|png|webp|gif
 *   → Cloudflare R2 bucket (LISTINGS_COLLECTION env → bucket name)
 *   Each subfolder becomes a key prefix in R2: "{slug}/{filename}"
 *   Files already in R2 are skipped (duplicate-safe).
 *   Name a file "main.*" to pin it as the cover photo when synced.
 *
 * Backend touched:
 *   - Cloudflare R2 bucket (R2_BUCKET_NAME in .env.local)
 *     Dev:  "proximity"       (R2_BUCKET_NAME)
 *     Prod: "proximity-prod"  (change R2_BUCKET_NAME or run sync-r2-images --prod)
 *
 * Usage:
 *   node sync-scripts/upload-images.mjs            # upload all, skip existing
 *   node sync-scripts/upload-images.mjs --dry-run  # preview without uploading
 *
 * Typical workflow:
 *   1. Add photos to public/listing-pics/{address-slug}/
 *   2. node sync-scripts/upload-images.mjs
 *   3. node sync-scripts/sync-r2-images.mjs [--prod]
 */

import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join, extname } from "path";

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

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${envVars.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: envVars.R2_ACCESS_KEY_ID,
    secretAccessKey: envVars.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = envVars.R2_BUCKET_NAME;
const SOURCE_DIR = resolve(process.cwd(), "public/listing-pics");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// Trailing words to strip before slugifying a folder name.
// Noise words first, then street type suffixes (order matters — strip noise before type).
const NOISE_WORDS = /\b(pictures?|photos?|pics?|images?)\b/gi;
const STREET_SUFFIXES =
  /\b(ave\.?|avenue|st\.?|street|blvd\.?|boulevard|rd\.?|road|dr\.?|drive|ln\.?|lane|way|ct\.?|court|pl\.?|place|pkwy\.?|parkway|terr?\.?|terrace|cir\.?|circle|loop|trl\.?|trail)\s*$/i;

/**
 * Convert a folder name or address string to a canonical address slug.
 *   "6042 Kingsbury Ave. Pictures" → "6042-kingsbury"
 *   "7515 Forsyth Blvd, Clayton, MO" → "7515-forsyth"
 */
function toAddressSlug(name) {
  return name
    .split(",")[0]          // take street portion only
    .replace(NOISE_WORDS, "") // strip noise words (pictures, photos, etc.)
    .replace(STREET_SUFFIXES, "") // strip trailing street type
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function listExistingR2Keys() {
  const keys = new Set();
  let continuationToken;
  do {
    const res = await r2.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: continuationToken })
    );
    for (const obj of res.Contents || []) keys.add(obj.Key);
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function main() {
  let slugFolders;
  try {
    slugFolders = readdirSync(SOURCE_DIR).filter((name) => {
      const fullPath = join(SOURCE_DIR, name);
      return statSync(fullPath).isDirectory();
    });
  } catch {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    console.error("Create public/listing-pics/ and add address-slug subfolders.");
    process.exit(1);
  }

  if (slugFolders.length === 0) {
    console.log("No subfolders found in public/listing-pics/");
    return;
  }

  if (isDryRun) {
    console.log("[DRY RUN] No files will be uploaded.\n");
  }

  console.log("Fetching existing R2 keys...");
  const existingKeys = isDryRun ? new Set() : await listExistingR2Keys();
  if (!isDryRun) console.log(`  ${existingKeys.size} files already in R2\n`);

  let totalUploaded = 0;
  let totalSkipped = 0;

  for (const folderName of slugFolders) {
    const slug = toAddressSlug(folderName);
    const folderPath = join(SOURCE_DIR, folderName);
    const files = readdirSync(folderPath).filter((f) => {
      const ext = extname(f).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext) && statSync(join(folderPath, f)).isFile();
    });

    if (files.length === 0) {
      console.log(`  [skip] ${folderName}/ — no image files`);
      totalSkipped++;
      continue;
    }

    const label = slug !== folderName ? `${folderName}/ → ${slug}/` : `${slug}/`;
    console.log(`\n${label} (${files.length} image${files.length !== 1 ? "s" : ""})`);

    for (const filename of files) {
      const key = `${slug}/${filename}`;
      const ext = extname(filename).toLowerCase();
      const contentType = CONTENT_TYPES[ext] || "application/octet-stream";

      if (isDryRun) {
        console.log(`  [dry-run] would upload → ${key}`);
        totalUploaded++;
        continue;
      }

      if (existingKeys.has(key)) {
        console.log(`  [skip] ${key} — already in R2`);
        totalSkipped++;
        continue;
      }

      const fileBuffer = readFileSync(join(folderPath, filename));
      await r2.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: fileBuffer,
          ContentType: contentType,
        })
      );
      console.log(`  ✓ uploaded → ${key}`);
      totalUploaded++;
    }
  }

  console.log(
    `\nDone. ${totalUploaded} file${totalUploaded !== 1 ? "s" : ""} ${isDryRun ? "would be uploaded" : "uploaded"}, ${totalSkipped} folder${totalSkipped !== 1 ? "s" : ""} skipped.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
