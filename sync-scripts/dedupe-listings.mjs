/**
 * dedupe-listings.mjs
 * ───────────────────
 * Pulls all listings from MongoDB, groups them by address slug, finds
 * duplicates, scores each one for completeness/refinement, and deletes
 * the weaker copy.
 *
 * Scoring (higher = better / keep):
 *   +3  per image
 *   +2  description length / 50 chars  (longer descriptions score higher)
 *   +2  per unitType entry
 *   +2  per amenity
 *   +1  contactEmail present
 *   +1  contactPhone present
 *   +1  contactName present
 *   +1  minRent / maxRent present (not null)
 *   +1  per review
 *   +1  rating > 0
 *   +1  leaseAvailability present
 *   +1  homeType present
 *
 * Backend touched:
 *   MongoDB "listings" collection
 *     Dev:  MONGO_URI      (default)
 *     Prod: MONGO_URI_PROD (--prod flag)
 *
 * Usage:
 *   node sync-scripts/dedupe-listings.mjs               # scan dev DB, dry-run by default
 *   node sync-scripts/dedupe-listings.mjs --prod        # scan prod DB, dry-run by default
 *   node sync-scripts/dedupe-listings.mjs --delete      # actually delete in dev
 *   node sync-scripts/dedupe-listings.mjs --prod --delete  # actually delete in prod
 *
 * NOTE: --delete is required to remove anything. Without it the script only
 *       reports what it would do. This is intentional — always verify the
 *       dry-run output before committing deletions.
 */

import { readFileSync } from "fs";
import { MongoClient, ObjectId } from "mongodb";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── env ──────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
const envVars = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      const raw = l
        .slice(i + 1)
        .trim()
        .replace(/^["']([^"']*)["'].*$/, "$1")
        .replace(/\s+#.*$/, "");
      return [l.slice(0, i).trim(), raw];
    })
);

const args = process.argv.slice(2);
const IS_PROD = args.includes("--prod");
const DO_DELETE = args.includes("--delete");

const MONGO_URI = IS_PROD ? envVars.MONGO_URI_PROD : envVars.MONGO_URI;
const COLLECTION = envVars.LISTINGS_COLLECTION || "listings";
const ENV_LABEL = IS_PROD ? "PROD" : "DEV";

if (!MONGO_URI) {
  console.error(
    `❌ ${IS_PROD ? "MONGO_URI_PROD" : "MONGO_URI"} not found in .env.local`
  );
  process.exit(1);
}

// ── address → slug ───────────────────────────────────────────────
const NOISE_WORDS = /\b(pictures?|photos?|pics?|images?)\b/gi;
const STREET_SUFFIXES =
  /\b(ave\.?|avenue|st\.?|street|blvd\.?|boulevard|rd\.?|road|dr\.?|drive|ln\.?|lane|way|ct\.?|court|pl\.?|place|pkwy\.?|parkway|terr?\.?|terrace|cir\.?|circle|loop|trl\.?|trail)\s*$/i;

function toSlug(address) {
  const tokens =
    address
      .replace(NOISE_WORDS, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [];
  // Skip leading building-name tokens (find first numeric = street number)
  const numIdx = tokens.findIndex((t) => /^\d+$/.test(t));
  const start = numIdx >= 0 ? numIdx : 0;
  return tokens.slice(start, start + 2).join("-");
}

// ── completeness score ────────────────────────────────────────────
function score(doc) {
  let s = 0;
  s += (doc.images?.length ?? 0) * 3;
  s += Math.floor((doc.description?.length ?? 0) / 50) * 2;
  s += (doc.unitTypes?.length ?? 0) * 2;
  s += (doc.amenities?.length ?? 0) * 2;
  if (doc.contactEmail) s += 1;
  if (doc.contactPhone) s += 1;
  if (doc.contactName) s += 1;
  if (doc.minRent != null) s += 1;
  if (doc.maxRent != null) s += 1;
  s += (doc.reviews?.length ?? 0) * 1;
  if ((doc.rating ?? 0) > 0) s += 1;
  if (doc.leaseAvailability) s += 1;
  if (doc.homeType) s += 1;
  return s;
}

function fmt(doc) {
  return [
    `id=${doc._id}`,
    `addr="${doc.address}"`,
    `imgs=${doc.images?.length ?? 0}`,
    `desc=${doc.description?.length ?? 0}ch`,
    `units=${doc.unitTypes?.length ?? 0}`,
    `score=${score(doc)}`,
  ].join("  ");
}

// ── main ──────────────────────────────────────────────────────────
const client = new MongoClient(MONGO_URI);
try {
  await client.connect();
  const col = client.db().collection(COLLECTION);

  const all = await col.find({}).toArray();
  console.log(`\n[${ENV_LABEL}] ${all.length} listings fetched from "${COLLECTION}"\n`);

  // Group by slug
  const groups = {};
  for (const doc of all) {
    const slug = toSlug(doc.address ?? "");
    if (!groups[slug]) groups[slug] = [];
    groups[slug].push(doc);
  }

  // Find duplicate groups (>1 doc per slug)
  const dupes = Object.entries(groups).filter(([, docs]) => docs.length > 1);

  if (dupes.length === 0) {
    console.log("✅ No duplicates found.");
    process.exit(0);
  }

  console.log(`⚠️  Found ${dupes.length} duplicate group(s):\n`);

  const toDelete = [];

  for (const [slug, docs] of dupes) {
    // Sort descending by score — first = best = keep
    docs.sort((a, b) => score(b) - score(a));

    const [keep, ...drop] = docs;

    console.log(`  Slug: "${slug}"  (${docs.length} copies)`);
    console.log(`  ✅ KEEP:   ${fmt(keep)}`);
    for (const d of drop) {
      console.log(`  🗑  DELETE: ${fmt(d)}`);
      toDelete.push(d._id);
    }
    console.log();
  }

  console.log(
    `Total to delete: ${toDelete.length} listing(s)` +
      (DO_DELETE ? "" : "  [dry-run — pass --delete to commit]")
  );

  if (!DO_DELETE) {
    console.log("\nRe-run with --delete to remove the duplicates shown above.");
    process.exit(0);
  }

  // Confirm before destroying
  console.log(`\n🗑  Deleting ${toDelete.length} listing(s) from [${ENV_LABEL}]…`);
  const result = await col.deleteMany({
    _id: { $in: toDelete.map((id) => new ObjectId(id)) },
  });
  console.log(`✅ Deleted ${result.deletedCount} listing(s).`);
} finally {
  await client.close();
}
