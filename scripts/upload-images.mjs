/**
 * Uploads listing images from public/listing-pics/ to Cloudflare R2.
 *
 * Directory structure:
 *   public/listing-pics/
 *     7515-forsyth-blvd/
 *       photo1.jpg
 *       photo2.jpg
 *
 * The subfolder name becomes the R2 key prefix (address slug).
 *
 * Usage:
 *   node scripts/upload-images.mjs           # upload all folders
 *   node scripts/upload-images.mjs --dry-run # preview without uploading
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
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
