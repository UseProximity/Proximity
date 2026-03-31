/**
 * migrate-to-supabase.mjs
 *
 * One-time migration: MongoDB (prod) → Supabase (PostgreSQL).
 *
 * Collections migrated (in dependency order):
 *   1. users            → users
 *   2. listings         → listings + listing_unit_types
 *   3. reviews          → reviews  (listing reviews only)
 *   4. dorms            → dorms
 *   5. dormreviews      → dorm_reviews  (dorm_id FK resolved by dorm.name)
 *   6. testimonials     → testimonials
 *   7. user.favorites[] → user_favorites  (junction)
 *   8. user.contacted[] → user_contacted  (junction)
 *
 * Prerequisites:
 *   - Run docs/supabase-schema.sql in the Supabase SQL editor first.
 *   - Add to .env.local:
 *       SUPABASE_URL=https://<project>.supabase.co
 *       SUPABASE_SERVICE_KEY=<service_role_key>
 *
 * Usage:
 *   node sync-scripts/migrate-to-supabase.mjs
 */

import { MongoClient } from "mongodb";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";

// ── Load .env.local ───────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
const envVars = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      const val = l.slice(i + 1).trim().replace(/\s+#.*$/, "");
      return [l.slice(0, i).trim(), val];
    })
);

const MONGO_URI    = envVars.MONGO_URI_PROD;
const SUPABASE_URL = envVars.PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = envVars.SUPABASE_SERVICE_KEY;

if (!MONGO_URI)    throw new Error("MONGO_URI_PROD missing from .env.local");
if (!SUPABASE_URL) throw new Error("PUBLIC_SUPABASE_URL missing from .env.local");
if (!SUPABASE_KEY) throw new Error("SUPABASE_SERVICE_KEY missing from .env.local");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const mongo    = new MongoClient(MONGO_URI);

// ── ID map: MongoDB ObjectId string → deterministic UUID ─────────────────────
// We generate UUIDs once and reuse them so cross-table FK references stay
// consistent even when collections are processed in separate passes.
const idMap = new Map();
function uuid(mongoId) {
  const key = mongoId?.toString();
  if (!key) return null;
  if (!idMap.has(key)) idMap.set(key, randomUUID());
  return idMap.get(key);
}

// ── Timestamp helper ──────────────────────────────────────────────────────────
function ts(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

// ── Batch upsert helper ───────────────────────────────────────────────────────
// Supabase has a ~1 MB payload limit; batch in chunks of 500.
async function upsert(table, rows, onConflict = "mongo_id") {
  if (!rows.length) { console.log(`  – ${table}: 0 rows (nothing to insert)`); return; }
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from(table)
      .upsert(chunk, { onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`[${table}] upsert failed: ${error.message}`);
  }
  console.log(`  ✓ ${table}: ${rows.length} rows`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
await mongo.connect();
// Explicitly extract and trim the DB name from the URI to avoid namespace
// errors caused by any trailing whitespace in the env var value.
const dbName = MONGO_URI.split("/").pop()?.split("?")[0]?.trim() || undefined;
const db = mongo.db(dbName);

// ─────────────────────────────────────────────────────────────────────────────
// 0. PRE-LOAD existing Supabase UUIDs into idMap
// This ensures that rows already migrated in a previous run keep their UUIDs,
// so FK references (landlord_id, listing_id, etc.) stay consistent.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[0/8] Loading existing IDs from Supabase...");
for (const table of ["users", "listings", "reviews", "dorms", "dorm_reviews", "testimonials"]) {
  const { data, error } = await supabase.from(table).select("id, mongo_id");
  if (error) { console.warn(`  ⚠  Could not load ${table}: ${error.message}`); continue; }
  for (const row of (data ?? [])) {
    if (row.mongo_id) idMap.set(row.mongo_id, row.id);
  }
  if (data?.length) console.log(`  ✓ pre-loaded ${data.length} IDs from ${table}`);
}
// Snapshot of all mongo_ids confirmed to exist in Supabase before this run
const supabaseMongoIds = new Set(idMap.keys());

// ─────────────────────────────────────────────────────────────────────────────
// 1. USERS
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[1/8] Users...");
const mongoUsers = await db.collection("users").find({}).toArray();

await upsert("users", mongoUsers.map((u) => ({
  id:               uuid(u._id),
  mongo_id:         u._id.toString(),
  name:             u.name         ?? null,
  email:            u.email        ?? null,
  image:            u.image        ?? null,
  role:             ["student", "landlord", "super"].includes(u.role) ? u.role : "student",
  birthday:         ts(u.birthday),
  description:      u.description  ?? "",
  gender:           u.gender       ?? "unspecified",
  num_reviews:      u.numReviews   ?? 0,
  phone:            u.phone        ?? "N/A",
  profile_complete: u.profileComplete ?? false,
  rating:           Math.min(5, Math.max(0, u.rating ?? 0)),
  referral_source:  u.referralSource ?? "",
  created_at:       ts(u.createdAt) ?? new Date().toISOString(),
  updated_at:       ts(u.updatedAt) ?? new Date().toISOString(),
})));

// ─────────────────────────────────────────────────────────────────────────────
// 2. LISTINGS + LISTING_UNITS
// Listing-level fields go to listings; all per-unit fields go to listing_units.
// The sync_listing_aggregates trigger will auto-fill min/max columns after units
// are inserted, so we seed them from MongoDB's stored values for speed.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2/8] Listings...");
const mongoListings = await db.collection("listings").find({}).toArray();
const unitRows      = [];

await upsert("listings", mongoListings.map((l) => {
  const listingId = uuid(l._id);

  // Expand each MongoDB unitType into a listing_units row, carrying listing-level
  // lease/furnish/amenity fields down to each unit (no per-unit equivalent in Mongo).
  (l.unitTypes ?? []).forEach((u) => {
    unitRows.push({
      id:                 randomUUID(),
      listing_id:         listingId,
      name:               u.name               ?? null,
      bedrooms:           u.bedrooms,
      bathrooms:          u.bathrooms,
      rent:               u.rent               ?? null,
      area:               u.area               ?? null,
      // Listing-level fields demoted to unit level
      furnished:          l.furnished          ?? false,
      utilities_included: Array.from(l.utilitiesIncluded ?? []),
      lease_availability: ["semester", "10-month", "12-month"].includes(l.leaseAvailability)
                            ? l.leaseAvailability : null,
      lease_structure:    ["individual", "joint"].includes(l.leaseStructure)
                            ? l.leaseStructure : null,
      move_in_date:       l.moveInDate         ?? null,
      sublease_friendly:  l.subleaseFriendly   ?? false,
      amenities:          Array.from(l.amenities ?? []),
      unavailable:        l.unavailable        ?? false,
    });
  });

  // placeWalkMinutes is a Mongoose Map — coerce to plain object
  let placeWalk = {};
  if (l.placeWalkMinutes instanceof Map) {
    placeWalk = Object.fromEntries(l.placeWalkMinutes);
  } else if (l.placeWalkMinutes && typeof l.placeWalkMinutes === "object") {
    placeWalk = { ...l.placeWalkMinutes };
  }

  return {
    id:                   listingId,
    mongo_id:             l._id.toString(),
    title:                l.title              ?? null,
    address:              l.address            ?? "",
    longitude:            l.longitude          ?? 0,
    latitude:             l.latitude           ?? 0,
    description:          l.description        ?? "",
    home_type:            l.homeType           ?? "apartment",
    lease_type:           l.leaseType          ?? "unknown",
    images:               Array.from(l.images ?? []),
    place_walk_minutes:   placeWalk,
    shuttle_walk_minutes: l.shuttleWalkMinutes ?? null,
    contact_email:        l.contactEmail       ?? null,
    contact_phone:        l.contactPhone       ?? null,
    contact_name:         l.contactName        ?? null,
    num_reviews:          l.numReviews         ?? 0,
    rating:               Math.min(5, Math.max(0, l.rating ?? 0)),
    num_clicks:           l.numClicks          ?? 0,
    num_saves:            l.numSaves           ?? 0,
    // Seed aggregates from Mongo; trigger will keep them in sync going forward
    min_rent:             l.minRent            ?? null,
    max_rent:             l.maxRent            ?? null,
    min_bedrooms:         l.minBedrooms        ?? null,
    max_bedrooms:         l.maxBedrooms        ?? null,
    min_bathrooms:        l.minBathrooms       ?? null,
    max_bathrooms:        l.maxBathrooms       ?? null,
    min_area:             l.minArea            ?? null,
    max_area:             l.maxArea            ?? null,
    landlord_id:          l.landlord ? uuid(l.landlord) : (l.owner ? uuid(l.owner) : null),
    created_at:           ts(l.createdAt) ?? new Date().toISOString(),
    updated_at:           ts(l.updatedAt) ?? new Date().toISOString(),
  };
}));

console.log("\n[2b/8] Listing units...");
// Units have no mongo_id — insert fresh (safe to re-run only if table is empty)
if (unitRows.length) {
  const CHUNK = 500;
  for (let i = 0; i < unitRows.length; i += CHUNK) {
    const { error } = await supabase.from("listing_units").insert(unitRows.slice(i, i + CHUNK));
    if (error) throw new Error(`[listing_units] insert failed: ${error.message}`);
  }
  console.log(`  ✓ listing_units: ${unitRows.length} rows`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. REVIEWS  (listing reviews only)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3/8] Reviews...");
const mongoReviews     = await db.collection("reviews").find({}).toArray();
const listingReviews   = mongoReviews.filter((r) => r.listing != null);
const skippedReviews   = mongoReviews.length - listingReviews.length;

if (skippedReviews > 0)
  console.log(`  ⚠  Skipping ${skippedReviews} user-only reviews (no listing reference)`);

await upsert("reviews", listingReviews.map((r) => ({
  id:                   uuid(r._id),
  mongo_id:             r._id.toString(),
  user_id:              uuid(r.reviewer),
  listing_id:           uuid(r.listing),
  rating:               Math.min(5, Math.max(0, r.rating ?? 0)),
  comment:              r.comment              ?? "",
  legitimacy:           r.legitimacy           ?? false,
  communication_rating: r.communicationRating  ?? null,
  location_rating:      r.locationRating       ?? null,
  value_rating:         r.valueRating          ?? null,
  created_at:           ts(r.createdAt) ?? new Date().toISOString(),
  updated_at:           ts(r.updatedAt) ?? new Date().toISOString(),
})));

// ─────────────────────────────────────────────────────────────────────────────
// 4. DORMS
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4/8] Dorms...");
const mongoDorms     = await db.collection("dorms").find({}).toArray();
const dormNameToUUID = new Map(); // lowercase dorm name → uuid

await upsert("dorms", mongoDorms.map((d) => {
  const dormId = uuid(d._id);
  dormNameToUUID.set(d.name.toLowerCase().trim(), dormId);
  return {
    id:          dormId,
    mongo_id:    d._id.toString(),
    name:        d.name,
    room_types:  d.roomTypes   ?? [],
    description: d.description ?? "",
    tags:        d.tags        ?? [],
    image:       d.image       ?? null,
    created_at:  ts(d.createdAt) ?? new Date().toISOString(),
    updated_at:  ts(d.updatedAt) ?? new Date().toISOString(),
  };
}));

// ─────────────────────────────────────────────────────────────────────────────
// 5. DORM REVIEWS  (FK resolved by dorm name)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5/8] Dorm reviews...");
const mongoDormReviews  = await db.collection("dormreviews").find({}).toArray();
let   dormReviewSkipped = 0;

const dormReviewRows = mongoDormReviews.flatMap((r) => {
  const dormId = dormNameToUUID.get(r.dorm?.toLowerCase().trim());
  if (!dormId) {
    console.warn(`  ⚠  No dorm match for "${r.dorm}" — skipping review ${r._id}`);
    dormReviewSkipped++;
    return [];
  }
  return [{
    id:            uuid(r._id),
    mongo_id:      r._id.toString(),
    dorm_id:       dormId,
    reviewer_name: r.name,
    class_year:    r.classYear,
    rating:        Math.min(5, Math.max(1, r.rating ?? 1)),
    dorm_type:     r.dormType  ?? "",
    tags:          r.tags      ?? [],
    content:       r.content,
    created_at:    ts(r.createdAt) ?? new Date().toISOString(),
    updated_at:    ts(r.updatedAt) ?? new Date().toISOString(),
  }];
});

await upsert("dorm_reviews", dormReviewRows);
if (dormReviewSkipped > 0)
  console.log(`  ⚠  ${dormReviewSkipped} dorm reviews skipped — unmatched dorm name`);

// ─────────────────────────────────────────────────────────────────────────────
// 6. TESTIMONIALS
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6/8] Testimonials...");
const mongoTestimonials = await db.collection("testimonials").find({}).toArray();

await upsert("testimonials", mongoTestimonials.map((t) => ({
  id:         uuid(t._id),
  mongo_id:   t._id.toString(),
  text:       t.text,
  author:     t.author,
  rating:     Math.min(5, Math.max(1, t.rating ?? 1)),
  created_at: ts(t.createdAt) ?? new Date().toISOString(),
  updated_at: ts(t.updatedAt) ?? new Date().toISOString(),
})));

// ─────────────────────────────────────────────────────────────────────────────
// 7 & 8. JUNCTION TABLES — user_favorites + user_contacted
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[7/8] User favorites...");
const favRows = mongoUsers.flatMap((u) =>
  (u.favorites ?? []).flatMap((lid) => {
    const key = lid?.toString();
    if (!key || !supabaseMongoIds.has(key)) return [];
    return [{ user_id: uuid(u._id), listing_id: uuid(lid) }];
  })
);
await upsert("user_favorites", favRows, "user_id,listing_id");

console.log("\n[8/8] User contacted...");
const contactedRows = mongoUsers.flatMap((u) =>
  (u.contacted ?? []).flatMap((lid) => {
    const key = lid?.toString();
    if (!key || !supabaseMongoIds.has(key)) return [];
    return [{ user_id: uuid(u._id), listing_id: uuid(lid) }];
  })
);
await upsert("user_contacted", contactedRows, "user_id,listing_id");

// ─────────────────────────────────────────────────────────────────────────────
// Done
// ─────────────────────────────────────────────────────────────────────────────
await mongo.close();

console.log(`
✅ Migration complete!

Summary of ID map:
  ${idMap.size} MongoDB ObjectIds mapped to UUIDs

Next steps:
  1. Verify row counts in Supabase match MongoDB
  2. Add SUPABASE_URL + SUPABASE_ANON_KEY to .env.local for the app
  3. Update app API routes to use @supabase/supabase-js instead of Mongoose
`);
