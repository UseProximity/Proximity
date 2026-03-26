/**
 * update-walk-times-prod.mjs
 * Recomputes walking times to campus, key places, and shuttle stops for prod listings only.
 *
 * What it syncs:
 *   Mapbox Directions API (walking routes)
 *   → MongoDB prod listings.campusWalkMinutes, listings.placeWalkMinutes, listings.shuttleWalkMinutes
 *   Only processes listings that have latitude/longitude set.
 *
 * Backend touched:
 *   - Mapbox Directions API (NEXT_PUBLIC_MAPBOX_TOKEN) — one request per listing per destination
 *   - MongoDB prod cluster (MONGO_URI_PROD) → "listings" collection — updates walk time fields
 *
 * Usage:
 *   node sync-scripts/update-walk-times-prod.mjs     # updates prod only
 *
 * To update both dev and prod, use update-walk-times.mjs instead.
 */
// Run with: node sync-scripts/update-walk-times-prod.mjs
import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env.local
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, "");
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const MONGO_URI = process.env.MONGO_URI || process.env.PROD_MONGO_URI;

if (!MONGO_URI) {
  console.error("Missing MONGO_URI env var");
  process.exit(1);
}
if (!MAPBOX_TOKEN) {
  console.error("Missing NEXT_PUBLIC_MAPBOX_TOKEN env var");
  process.exit(1);
}

const WASHU_PLACES = [
  { name: "Olin Library",               lat: 38.64851503785516,  lng: -90.30770757138812 },
  { name: "Seigle Hall",                lat: 38.64901252229954,  lng: -90.31234570424581 },
  { name: "Schnucks (Grocery)",         lat: 38.633335917020425, lng: -90.31473611720082 },
  { name: "Danforth University Center", lat: 38.64754193120054,  lng: -90.31037361422699 },
  { name: "Sumers Rec Center",          lat: 38.64933192571885,  lng: -90.31472066027095 },
  { name: "Village House",              lat: 38.65056939432417,  lng: -90.31405161268682 },
];

const SHUTTLE_STOPS = [
  { lat: 38.6473, lng: -90.3097 },
  { lat: 38.6482, lng: -90.3049 },
  { lat: 38.6463, lng: -90.3041 },
  { lat: 38.6485, lng: -90.3077 },
  { lat: 38.6491, lng: -90.3061 },
  { lat: 38.6492, lng: -90.3006 },
  { lat: 38.6457, lng: -90.3152 },
  { lat: 38.6454, lng: -90.3125 },
  { lat: 38.6449, lng: -90.3146 },
  { lat: 38.6517, lng: -90.3153 },
  { lat: 38.6442, lng: -90.3159 },
  { lat: 38.6582, lng: -90.2977 },
  { lat: 38.6562, lng: -90.3052 },
  { lat: 38.6538, lng: -90.2800 },
  { lat: 38.6478, lng: -90.2846 },
  { lat: 38.6362, lng: -90.2619 },
];

const CAMPUS = { lat: 38.64754193120054, lng: -90.31037361422699 };

async function fetchWalkMinutes(lat, lng, destLat, destLng) {
  const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${lng},${lat};${destLng},${destLat}?access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  const seconds = data.routes?.[0]?.duration ?? null;
  return seconds != null ? Math.round(seconds / 60) : null;
}

async function geocodeAddress(address) {
  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
  const res = await fetch(url);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.center;
  return { lat, lng };
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log("Connected to MongoDB");

  const db = client.db();
  const listings = db.collection("listings");

  // Geocode any listings missing lat/lng first
  const needsGeocode = await listings
    .find({ $or: [{ latitude: { $exists: false } }, { longitude: { $exists: false } }] })
    .project({ _id: 1, address: 1 })
    .toArray();

  if (needsGeocode.length > 0) {
    console.log(`\nGeocoding ${needsGeocode.length} listings missing coordinates...`);
    for (const doc of needsGeocode) {
      const coords = await geocodeAddress(doc.address);
      if (coords) {
        await listings.updateOne({ _id: doc._id }, { $set: { latitude: coords.lat, longitude: coords.lng } });
        console.log(`  Geocoded "${doc.address}" → ${coords.lat}, ${coords.lng}`);
      } else {
        console.warn(`  ⚠ Could not geocode "${doc.address}"`);
      }
    }
  }

  const docs = await listings
    .find({ latitude: { $exists: true }, longitude: { $exists: true } })
    .project({ _id: 1, latitude: 1, longitude: 1, address: 1 })
    .toArray();

  console.log(`Found ${docs.length} listings to update`);

  let updated = 0;
  let failed = 0;

  for (const doc of docs) {
    try {
      const { latitude: lat, longitude: lng } = doc;

      const campusWalkMinutes = await fetchWalkMinutes(lat, lng, CAMPUS.lat, CAMPUS.lng);

      const placeResults = await Promise.all(
        WASHU_PLACES.map(async (place) => {
          const minutes = await fetchWalkMinutes(lat, lng, place.lat, place.lng);
          return [place.name, minutes];
        })
      );
      const placeWalkMinutes = Object.fromEntries(placeResults.filter(([, m]) => m != null));

      const shuttleTimes = await Promise.all(
        SHUTTLE_STOPS.map((s) => fetchWalkMinutes(lat, lng, s.lat, s.lng))
      );
      const validShuttle = shuttleTimes.filter((m) => m != null);
      const shuttleWalkMinutes = validShuttle.length > 0 ? Math.min(...validShuttle) : null;

      await listings.updateOne(
        { _id: doc._id },
        { $set: { campusWalkMinutes, placeWalkMinutes, shuttleWalkMinutes } }
      );

      console.log(`  Updated ${doc._id}: campus=${campusWalkMinutes}min, shuttle=${shuttleWalkMinutes}min`);
      updated++;
    } catch (err) {
      console.error(`  Failed ${doc._id}:`, err.message);
      failed++;
    }
  }

  console.log(`\nDone: ${updated} updated, ${failed} failed`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
