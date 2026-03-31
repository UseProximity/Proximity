/**
 * update-walk-times.mjs
 * Recomputes walking times to campus, key places, and shuttle stops for all listings.
 *
 * What it syncs:
 *   Mapbox Directions API (walking routes)
 *   → MongoDB listings.campusWalkMinutes, listings.placeWalkMinutes, listings.shuttleWalkMinutes
 *   Runs against BOTH dev and prod databases in sequence.
 *   Only processes listings that have latitude/longitude set.
 *
 * Backend touched:
 *   - Mapbox Directions API (NEXT_PUBLIC_MAPBOX_TOKEN) — one request per listing per destination
 *   - MongoDB dev cluster  (MONGO_URI)      → "listings" collection — updates walk time fields
 *   - MongoDB prod cluster (MONGO_URI_PROD) → "listings" collection — updates walk time fields
 *
 * Usage:
 *   node sync-scripts/update-walk-times.mjs          # updates dev + prod
 *
 * To update prod only, use update-walk-times-prod.mjs.
 */

import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { WASHU_PLACES, SHUTTLE_STOPS, CAMPUS } from "../utils/washuPlaces.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const MAPBOX_TOKEN = envVars.NEXT_PUBLIC_MAPBOX_TOKEN;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchWalkMinutes(lat, lng, destLat, destLng) {
  const origin = `${lng},${lat}`;
  const dest = `${destLng},${destLat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${origin};${dest}?access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  const seconds = data.routes?.[0]?.duration ?? null;
  return seconds != null ? Math.round(seconds / 60) : null;
}

async function updateDB(uri, label) {
  console.log(`\n--- ${label} (${uri.split("/").pop()}) ---`);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const listings = await db
    .collection("listings")
    .find({ latitude: { $exists: true, $ne: null }, longitude: { $exists: true, $ne: null } })
    .project({ _id: 1, latitude: 1, longitude: 1 })
    .toArray();

  console.log(`Found ${listings.length} listings`);
  let updated = 0, failed = 0;

  for (const listing of listings) {
    try {
      const { latitude: lat, longitude: lng } = listing;

      const campusWalkMinutes = await fetchWalkMinutes(lat, lng, CAMPUS.lat, CAMPUS.lng);

      const placeResults = await Promise.all(
        WASHU_PLACES.map(async (place) => {
          const minutes = await fetchWalkMinutes(lat, lng, place.lat, place.lng);
          return [place.name, minutes];
        })
      );
      const placeWalkMinutes = Object.fromEntries(placeResults.filter(([, m]) => m != null));

      // Only call Mapbox for the 5 nearest stops by straight-line distance
      const nearest5 = [...SHUTTLE_STOPS]
        .sort((a, b) => haversineKm(lat, lng, a.lat, a.lng) - haversineKm(lat, lng, b.lat, b.lng))
        .slice(0, 5);
      const shuttleTimes = await Promise.all(nearest5.map((s) => fetchWalkMinutes(lat, lng, s.lat, s.lng)));
      const validShuttle = shuttleTimes.filter((m) => m != null);
      const shuttleWalkMinutes = validShuttle.length > 0 ? Math.min(...validShuttle) : null;

      await db.collection("listings").updateOne(
        { _id: listing._id },
        { $set: { campusWalkMinutes, placeWalkMinutes, shuttleWalkMinutes } }
      );

      const flag = (campusWalkMinutes == null || shuttleWalkMinutes == null) ? " ⚠️ null" : "";
      console.log(`  ✓ ${listing._id} (${lat}, ${lng}) — campus: ${campusWalkMinutes}min, shuttle: ${shuttleWalkMinutes}min${flag}`);
      updated++;
    } catch (err) {
      console.error(`  ✗ ${listing._id} — ${err.message}`);
      failed++;
    }
  }

  console.log(`Done: ${updated} updated, ${failed} failed`);
  await client.close();
}

await updateDB(envVars.MONGO_URI, "DEV");
await updateDB(envVars.MONGO_URI_PROD, "PROD");
