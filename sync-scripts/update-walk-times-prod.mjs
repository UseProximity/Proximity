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
import { WASHU_PLACES, SHUTTLE_STOPS } from "../utils/washuPlaces.js";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

      const placeWalkMinutes = {};
      for (const place of WASHU_PLACES) {
        const minutes = await fetchWalkMinutes(lat, lng, place.lat, place.lng);
        if (minutes != null) placeWalkMinutes[place.name] = minutes;
        await sleep(200);
      }
      const placeValues = Object.values(placeWalkMinutes);
      const campusWalkMinutes = placeValues.length > 0 ? Math.min(...placeValues) : null;

      const nearest5 = [...SHUTTLE_STOPS]
        .sort((a, b) => haversineKm(lat, lng, a.lat, a.lng) - haversineKm(lat, lng, b.lat, b.lng))
        .slice(0, 5);
      const shuttleTimes = [];
      for (const s of nearest5) {
        shuttleTimes.push(await fetchWalkMinutes(lat, lng, s.lat, s.lng));
        await sleep(200);
      }
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
