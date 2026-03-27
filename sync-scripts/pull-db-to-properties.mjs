/**
 * pull-db-to-properties.mjs
 * ─────────────────────────
 * Pulls listings from MongoDB and writes them back to properties.json,
 * merging each DB record into its matching properties.json entry by
 * address slug. The DB is treated as the source of truth for fields
 * that may have been updated in the app (images, reviews, rating, etc.).
 * Fields that only exist in properties.json (e.g. hand-crafted description)
 * are preserved unless --overwrite-description is passed.
 *
 * What gets pulled from DB → properties.json:
 *   images, numReviews, rating, reviews    (always)
 *   description                            (only with --overwrite-description)
 *   unitTypes, amenities, minRent, maxRent (only with --overwrite-units)
 *
 * Backend touched:
 *   MongoDB "listings" collection (READ ONLY)
 *     Dev:  MONGO_URI      (default, no flag)
 *     Prod: MONGO_URI_PROD (--prod flag)
 *
 * Usage:
 *   node sync-scripts/pull-db-to-properties.mjs                        # dry-run from dev
 *   node sync-scripts/pull-db-to-properties.mjs --prod                 # dry-run from prod
 *   node sync-scripts/pull-db-to-properties.mjs --prod --write         # write to properties.json from prod
 *   node sync-scripts/pull-db-to-properties.mjs --prod --write --overwrite-description
 *   node sync-scripts/pull-db-to-properties.mjs --prod --write --overwrite-units
 */

import { readFileSync, writeFileSync } from "fs";
import { MongoClient } from "mongodb";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROPERTIES_PATH = resolve(__dirname, "properties.json");

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
const DO_WRITE = args.includes("--write");
const OVERWRITE_DESC = args.includes("--overwrite-description");
const OVERWRITE_UNITS = args.includes("--overwrite-units");

const MONGO_URI = IS_PROD ? envVars.MONGO_URI_PROD : envVars.MONGO_URI;
const COLLECTION = envVars.LISTINGS_COLLECTION || "listings";
const ENV_LABEL = IS_PROD ? "PROD" : "DEV";

if (!MONGO_URI) {
  console.error(
    `❌ ${IS_PROD ? "MONGO_URI_PROD" : "MONGO_URI"} not found in .env.local`
  );
  process.exit(1);
}

// ── slug helpers (same as other sync scripts) ────────────────────
const NOISE_WORDS = /\b(pictures?|photos?|pics?|images?)\b/gi;

function toSlug(address = "") {
  const tokens =
    address
      .replace(NOISE_WORDS, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [];
  const numIdx = tokens.findIndex((t) => /^\d+$/.test(t));
  const start = numIdx >= 0 ? numIdx : 0;
  return tokens.slice(start, start + 2).join("-");
}

// ── main ──────────────────────────────────────────────────────────
const client = new MongoClient(MONGO_URI);
try {
  await client.connect();
  const col = client.db().collection(COLLECTION);
  const dbListings = await col.find({}).toArray();
  console.log(
    `\n[${ENV_LABEL}] ${dbListings.length} listing(s) fetched from "${COLLECTION}"\n`
  );

  // Build slug → DB doc map (best scoring doc wins if there are still dupes)
  const dbBySlug = {};
  for (const doc of dbListings) {
    const slug = toSlug(doc.address);
    const existing = dbBySlug[slug];
    if (!existing || scoreDoc(doc) > scoreDoc(existing)) {
      dbBySlug[slug] = doc;
    }
  }

  // Load properties.json
  const raw = readFileSync(PROPERTIES_PATH, "utf8");
  const properties = JSON.parse(raw.replace(/^\/\*[\s\S]*?\*\/\s*/, ""));

  let matched = 0;
  let unmatched = 0;
  const changes = [];

  for (const prop of properties) {
    const slug = toSlug(prop.address);
    const db = dbBySlug[slug];

    if (!db) {
      console.warn(`  ⚠️  No DB match for: ${prop.address} (slug: ${slug})`);
      unmatched++;
      continue;
    }

    matched++;
    const diff = {};

    // Always sync: images, reviews, rating, numReviews
    for (const key of ["images", "reviews", "numReviews", "rating"]) {
      const dbVal = db[key];
      if (JSON.stringify(prop[key]) !== JSON.stringify(dbVal)) {
        diff[key] = { from: prop[key], to: dbVal };
        if (DO_WRITE) prop[key] = dbVal;
      }
    }

    // Optional: description
    if (OVERWRITE_DESC && db.description && db.description !== prop.description) {
      diff.description = {
        from: prop.description?.slice(0, 60) + "…",
        to: db.description?.slice(0, 60) + "…",
      };
      if (DO_WRITE) prop.description = db.description;
    }

    // Optional: unit/pricing fields
    if (OVERWRITE_UNITS) {
      for (const key of [
        "unitTypes",
        "amenities",
        "minRent",
        "maxRent",
        "minBedrooms",
        "maxBedrooms",
        "minBathrooms",
        "maxBathrooms",
        "utilitiesIncluded",
        "leaseAvailability",
        "leaseStructure",
        "homeType",
      ]) {
        if (JSON.stringify(prop[key]) !== JSON.stringify(db[key])) {
          diff[key] = { from: prop[key], to: db[key] };
          if (DO_WRITE) prop[key] = db[key];
        }
      }
    }

    if (Object.keys(diff).length > 0) {
      changes.push({ address: prop.address, slug, diff });
    }
  }

  // Report
  console.log(`Matched: ${matched}  |  Unmatched: ${unmatched}`);
  if (changes.length === 0) {
    console.log("✅ properties.json is already in sync with the DB.\n");
  } else {
    console.log(
      `\n${DO_WRITE ? "✏️  Applied" : "🔍 Would apply"} ${changes.length} change(s):\n`
    );
    for (const { address, diff } of changes) {
      console.log(`  • ${address}`);
      for (const [key, { from, to }] of Object.entries(diff)) {
        const fromStr = JSON.stringify(from);
        const toStr = JSON.stringify(to);
        // Keep output readable for arrays
        if (key === "images") {
          console.log(
            `      images: ${Array.isArray(from) ? from.length : 0} → ${Array.isArray(to) ? to.length : 0} items`
          );
        } else {
          console.log(
            `      ${key}: ${fromStr.slice(0, 50)} → ${toStr.slice(0, 50)}`
          );
        }
      }
    }
  }

  if (DO_WRITE && changes.length > 0) {
    const header = `/**\n * Paste one or more documents here\n */\n`;
    writeFileSync(PROPERTIES_PATH, header + JSON.stringify(properties, null, 2));
    console.log(`\n✅ properties.json written.`);
  } else if (!DO_WRITE && changes.length > 0) {
    console.log(
      "\nRe-run with --write to apply these changes to properties.json."
    );
  }
} finally {
  await client.close();
}

function scoreDoc(doc) {
  let s = 0;
  s += (doc.images?.length ?? 0) * 3;
  s += Math.floor((doc.description?.length ?? 0) / 50) * 2;
  s += (doc.unitTypes?.length ?? 0) * 2;
  s += (doc.amenities?.length ?? 0) * 2;
  if (doc.contactEmail) s += 1;
  if (doc.contactPhone) s += 1;
  if (doc.minRent != null) s += 1;
  s += (doc.reviews?.length ?? 0);
  return s;
}
