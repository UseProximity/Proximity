/**
 * Updates campusWalkMinutes, placeWalkMinutes, and shuttleWalkMinutes
 * for all listings in both dev and prod databases.
 *
 * Usage: node scripts/update-walk-times.mjs
 *
 * Reads MONGO_URI, MONGO_URI_PROD, and NEXT_PUBLIC_MAPBOX_TOKEN from .env.local
 */

import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { resolve } from "path";

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
  { name: "560 Music Center",                  lat: 38.6556611, lng: -90.3108944 },
  { name: "801 Skinker",                       lat: 38.6360172, lng: -90.3037614 },
  { name: "Asbury & Forsyth",                  lat: 38.6480486, lng: -90.3216069 },
  { name: "Belt Avenue",                       lat: 38.6489544, lng: -90.2781660 },
  { name: "Big Bend & Shepley",                lat: 38.6458608, lng: -90.3159601 },
  { name: "Brentwood Promenade",               lat: 38.6267646, lng: -90.3428694 },
  { name: "Clara",                             lat: 38.6487360, lng: -90.2830247 },
  { name: "Clemons & Eastgate",                lat: 38.6573676, lng: -90.3008179 },
  { name: "Clemons & Interdrive",              lat: 38.6585415, lng: -90.3029402 },
  { name: "Clemons & Leland",                  lat: 38.6590248, lng: -90.3057594 },
  { name: "Clemons & Syracuse",                lat: 38.6591841, lng: -90.3072009 },
  { name: "Concordia",                         lat: 38.6345369, lng: -90.3161451 },
  { name: "Delmar & Skinker",                  lat: 38.6556166, lng: -90.2998768 },
  { name: "Delmar DivINe",                     lat: 38.6547735, lng: -90.2961463 },
  { name: "DeMun & Clayton",                   lat: 38.6339097, lng: -90.3094677 },
  { name: "Des Peres and Forest Park Parkway", lat: 38.6484739, lng: -90.2961948 },
  { name: "East End Garage",                   lat: 38.6476499, lng: -90.3017893 },
  { name: "Eastgate",                          lat: 38.6559523, lng: -90.3008701 },
  { name: "Eastgate & Cates",                  lat: 38.6584065, lng: -90.3005014 },
  { name: "Forsyth & Jackson",                 lat: 38.6481870, lng: -90.3223522 },
  { name: "Galleria",                          lat: 38.6262942, lng: -90.3468040 },
  { name: "Goldfarb",                          lat: 38.6477847, lng: -90.3050614 },
  { name: "Kingsbury & Des Peres",             lat: 38.6517200, lng: -90.2964659 },
  { name: "Knight Center",                     lat: 38.6486244, lng: -90.3086566 },
  { name: "Lewis Collaborative",               lat: 38.6584327, lng: -90.3082932 },
  { name: "Link in the Loop",                  lat: 38.6559082, lng: -90.3027041 },
  { name: "Lofts Apartments",                  lat: 38.6566251, lng: -90.3017574 },
  { name: "Mallinckrodt Bus Plaza",            lat: 38.6484518, lng: -90.3083764 },
  { name: "Med School",                        lat: 38.6460756, lng: -90.2849090 },
  { name: "Millbrook Garage",                  lat: 38.6488264, lng: -90.3096118 },
  { name: "Pershing",                          lat: 38.6481494, lng: -90.2804922 },
  { name: "Pershing @ DeBaliviere",            lat: 38.6485682, lng: -90.2846809 },
  { name: "Rosebury & Skinker",                lat: 38.6438622, lng: -90.3040748 },
  { name: "Rosedale & Washington",             lat: 38.6543791, lng: -90.2966001 },
  { name: "S-40, Clocktower",                  lat: 38.6453046, lng: -90.3129323 },
  { name: "S-40, Habif Health",                lat: 38.6474517, lng: -90.3131218 },
  { name: "Skinker & FPP",                     lat: 38.6492041, lng: -90.3076171 },
  { name: "Skinker & Pershing",                lat: 38.6492588, lng: -90.3076171 },
  { name: "Snow Way",                          lat: 38.6491773, lng: -90.3118868 },
  { name: "South Campus",                      lat: 38.6440918, lng: -90.3161865 },
  { name: "Sumers Welcome Center Pavillion",   lat: 38.6478149, lng: -90.3039093 },
  { name: "U-City Grill",                      lat: 38.6562705, lng: -90.3074038 },
  { name: "Walmart",                           lat: 38.6265316, lng: -90.3368745 },
  { name: "Wash Ave & Kingsland",              lat: 38.6553803, lng: -90.3075060 },
  { name: "Washington & Des Peres",            lat: 38.6547034, lng: -90.2961948 },
  { name: "Washington Avenue",                 lat: 38.6549521, lng: -90.3040748 },
  { name: "Waterman Blvd.",                    lat: 38.6494588, lng: -90.2803695 },
  { name: "WC Lower Lot",                      lat: 38.6484739, lng: -90.3204517 },
  { name: "Westgate",                          lat: 38.6499664, lng: -90.3063803 },
  { name: "Westminster",                       lat: 38.6532942, lng: -90.2965661 },
  { name: "Westminster & Skinker",             lat: 38.6536271, lng: -90.2998791 },
  { name: "Whitaker Hall",                     lat: 38.6491496, lng: -90.3036366 },
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
