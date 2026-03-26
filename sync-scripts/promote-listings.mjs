/**
 * promote-listings.mjs
 * Promotes verified listings from staging into the live listings collection.
 *
 * What it syncs:
 *   MongoDB "parsed-listings" collection (staging)
 *   → MongoDB "listings" collection (live)
 *   Skips any document whose address already exists in "listings". Safe to re-run.
 *
 * Backend touched:
 *   - MongoDB dev cluster (MONGO_URI)
 *     Reads from:  "parsed-listings" collection
 *     Writes to:   "listings" collection
 *
 * Usage:
 *   node sync-scripts/promote-listings.mjs
 *
 * Typical flow (after import-to-prod.mjs):
 *   1. Verify docs look correct in "parsed-listings" (via Compass or fetch-listings.mjs)
 *   2. node sync-scripts/promote-listings.mjs  ← promotes to live
 */

import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
const envPath = join(__dirname, "../.env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, "");
}

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error("Missing MONGO_URI"); process.exit(1); }

const client = new MongoClient(MONGO_URI);
await client.connect();
const db = client.db();

const parsed   = db.collection("parsed-listings");
const listings = db.collection("listings");

const sources = await parsed.find({}).toArray();
console.log(`Found ${sources.length} parsed listings`);

// Build set of addresses already in listings to avoid duplicates
const existing = await listings.distinct("address");
const existingSet = new Set(existing);

let inserted = 0, updated = 0;

for (const doc of sources) {
  const leaseType = doc.leaseAvailability ?? doc.leaseStructure ?? "year";
  const { _id, ...rest } = doc;
  const payload = { ...rest, leaseType };

  if (existingSet.has(doc.address)) {
    // Update contact fields and any other scalar fields, but don't overwrite
    // images, reviews, ratings, or walk times that may have been set manually
    await listings.updateOne(
      { address: doc.address },
      { $set: {
          contactEmail:     payload.contactEmail,
          contactPhone:     payload.contactPhone,
          contactName:      payload.contactName,
          description:      payload.description,
          unitTypes:        payload.unitTypes,
          leaseStructure:   payload.leaseStructure,
          leaseAvailability:payload.leaseAvailability,
          leaseType:        payload.leaseType,
          homeType:         payload.homeType,
          amenities:        payload.amenities,
          utilitiesIncluded:payload.utilitiesIncluded,
          subleaseFriendly: payload.subleaseFriendly,
          minRent:          payload.minRent,
          maxRent:          payload.maxRent,
          minBedrooms:      payload.minBedrooms,
          maxBedrooms:      payload.maxBedrooms,
          minBathrooms:     payload.minBathrooms,
          maxBathrooms:     payload.maxBathrooms,
      }}
    );
    console.log(`  updated "${doc.address}"`);
    updated++;
  } else {
    await listings.insertOne(payload);
    console.log(`  added   "${doc.address}"`);
    inserted++;
  }
}

await client.close();
console.log(`\nDone: ${inserted} inserted, ${updated} updated`);
