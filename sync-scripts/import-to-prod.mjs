/**
 * import-to-prod.mjs
 * Imports listings from properties.json directly into the prod MongoDB database.
 *
 * What it syncs:
 *   sync-scripts/properties.json
 *   → prod MongoDB collection (controlled by LISTINGS_COLLECTION in .env.local)
 *   No running server required — geocoding and walk times are computed inline.
 *
 * Backend touched:
 *   - MongoDB prod cluster (MONGO_URI_PROD)
 *     Target collection set by LISTINGS_COLLECTION in .env.local:
 *       LISTINGS_COLLECTION=parsed-listings  → safe staging collection (default for testing)
 *       LISTINGS_COLLECTION=listings         → live listings collection
 *   - Mapbox Directions API (NEXT_PUBLIC_MAPBOX_TOKEN) — for geocoding + walk times
 *
 * Usage:
 *   node sync-scripts/import-to-prod.mjs
 *
 * Recommended flow:
 *   1. Set LISTINGS_COLLECTION=parsed-listings, run, verify in Compass
 *   2. Run promote-listings.mjs to move verified docs to "listings"
 */

import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ───────────────────────────────────────────────────────────
const envPath = join(__dirname, "../.env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, "");
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const MONGO_URI    = process.env.MONGO_URI_PROD;
const COLLECTION   = process.env.LISTINGS_COLLECTION || "listings";

if (!MAPBOX_TOKEN) { console.error("Missing NEXT_PUBLIC_MAPBOX_TOKEN"); process.exit(1); }
if (!MONGO_URI)    { console.error("Missing MONGO_URI_PROD in .env.local"); process.exit(1); }

console.log(`Target: prod DB → "${COLLECTION}" collection`);

// ── Load parsed properties ────────────────────────────────────────────────────
const propertiesPath = join(__dirname, "properties.json");
let listings;
try {
  const raw = readFileSync(propertiesPath, "utf8")
    .replace(/^\/\*[\s\S]*?\*\/\s*/m, "");
  listings = JSON.parse(raw);
} catch (err) {
  console.error("Failed to parse properties.json:", err.message);
  console.error("Run `node sync-scripts/parse-properties-csv.mjs` first.");
  process.exit(1);
}

console.log(`Loaded ${listings.length} listings from properties.json\n`);

// ── Mapbox helpers ────────────────────────────────────────────────────────────
const WASHU_PLACES = [
  { name: "Olin Library",               lat: 38.64851503785516,  lng: -90.30770757138812 },
  { name: "Seigle Hall",                lat: 38.64901252229954,  lng: -90.31234570424581 },
  { name: "Schnucks (Grocery)",         lat: 38.633335917020425, lng: -90.31473611720082 },
  { name: "Danforth University Center", lat: 38.64754193120054,  lng: -90.31037361422699 },
  { name: "Sumers Rec Center",          lat: 38.64933192571885,  lng: -90.31472066027095 },
  { name: "Village House",              lat: 38.65056939432417,  lng: -90.31405161268682 },
];
const CAMPUS = { lat: 38.64754193120054, lng: -90.31037361422699 };
const SHUTTLE_STOPS = [
  { lat: 38.6473, lng: -90.3097 }, { lat: 38.6482, lng: -90.3049 },
  { lat: 38.6463, lng: -90.3041 }, { lat: 38.6485, lng: -90.3077 },
  { lat: 38.6491, lng: -90.3061 }, { lat: 38.6492, lng: -90.3006 },
  { lat: 38.6457, lng: -90.3152 }, { lat: 38.6454, lng: -90.3125 },
  { lat: 38.6449, lng: -90.3146 }, { lat: 38.6517, lng: -90.3153 },
  { lat: 38.6442, lng: -90.3159 }, { lat: 38.6582, lng: -90.2977 },
  { lat: 38.6562, lng: -90.3052 }, { lat: 38.6538, lng: -90.2800 },
  { lat: 38.6478, lng: -90.2846 }, { lat: 38.6362, lng: -90.2619 },
];

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchWalkMinutes(lat, lng, destLat, destLng) {
  const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${lng},${lat};${destLng},${destLat}?access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  const seconds = data.routes?.[0]?.duration ?? null;
  return seconds != null ? Math.round(seconds / 60) : null;
}

async function geocodeAddress(address) {
  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&limit=1&country=US`;
  const res = await fetch(url);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.center;
  return { latitude: lat, longitude: lng };
}

async function fetchAllWalkTimes(lat, lng) {
  const campusWalkMinutes = await fetchWalkMinutes(lat, lng, CAMPUS.lat, CAMPUS.lng);

  const placeResults = await Promise.all(
    WASHU_PLACES.map(async (place) => {
      const minutes = await fetchWalkMinutes(lat, lng, place.lat, place.lng);
      return [place.name, minutes];
    })
  );
  const placeWalkMinutes = Object.fromEntries(placeResults.filter(([, m]) => m != null));

  const nearest5 = [...SHUTTLE_STOPS]
    .sort((a, b) => haversineKm(lat, lng, a.lat, a.lng) - haversineKm(lat, lng, b.lat, b.lng))
    .slice(0, 5);
  const shuttleTimes = await Promise.all(nearest5.map((s) => fetchWalkMinutes(lat, lng, s.lat, s.lng)));
  const validShuttle = shuttleTimes.filter((m) => m != null);
  const shuttleWalkMinutes = validShuttle.length > 0 ? Math.min(...validShuttle) : null;

  return { campusWalkMinutes, placeWalkMinutes, shuttleWalkMinutes };
}

// ── Import ────────────────────────────────────────────────────────────────────
const client = new MongoClient(MONGO_URI);
await client.connect();
console.log("Connected to prod MongoDB\n");

const col = client.db().collection(COLLECTION);

let succeeded = 0;
let failed = 0;

for (let i = 0; i < listings.length; i++) {
  const listing = listings[i];
  const label = `[${i + 1}/${listings.length}] ${listing.address}`;

  try {
    // Geocode
    const coords = await geocodeAddress(listing.address);
    if (!coords) {
      console.warn(`  SKIP (geocode failed): ${label}`);
      failed++;
      continue;
    }

    // Walk times
    const { campusWalkMinutes, placeWalkMinutes, shuttleWalkMinutes } =
      await fetchAllWalkTimes(coords.latitude, coords.longitude);

    const doc = {
      ...listing,
      latitude:  coords.latitude,
      longitude: coords.longitude,
      campusWalkMinutes,
      placeWalkMinutes,
      shuttleWalkMinutes,
      owner: null,
      createdAt: new Date(),
    };

    const result = await col.insertOne(doc);
    console.log(`  OK   ${label} → ${result.insertedId}`);
    succeeded++;
  } catch (err) {
    console.error(`  FAIL ${label}: ${err.message}`);
    failed++;
  }
}

await client.close();
console.log(`\nDone: ${succeeded} succeeded, ${failed} failed`);
if (failed > 0) process.exit(1);
