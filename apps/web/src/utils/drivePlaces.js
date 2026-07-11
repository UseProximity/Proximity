// Shared points of interest used for driving-time calculations.
// Consumed by the listing modal (display) and the API routes (storage).
//
// `name` MUST match the corresponding row in the `locations` table
// (migration 202607060001_create_listing_drive_times.sql). `label` is a
// display-only override for rows whose stored name isn't user-friendly.
//
// Two kinds of destinations, mirroring washuPlaces.js (WASHU_PLACES + SHUTTLE_STOPS):
//   1. DRIVE_PLACES        — fixed destinations shown individually.
//   2. NEAREST_DRIVE_POOLS — candidate pools; the app picks the nearest/fastest
//      and stores it under a synthetic `*_nearest` locations row.

export const DRIVE_PLACES = [
  // Shopping
  { name: "Trader Joe's (Brentwood)",      category: "grocery",     lat: 38.6273335,         lng: -90.3412312 },
  { name: "Costco (Olivette)",             category: "grocery",     lat: 38.676274,          lng: -90.358976 },
  { name: "Target (Brentwood)",            category: "grocery",     lat: 38.6279480,         lng: -90.3434056 },
  { name: "Galleria",                      category: "grocery",     lat: 38.6336406981314,   lng: -90.34618803034873, label: "Saint Louis Galleria" },

  // Attractions
  { name: "Forest Park (Skinker Entrance)", category: "attractions", lat: 38.6492020,        lng: -90.3006530 },
  { name: "Delmar Loop",                   category: "attractions", lat: 38.6558000,         lng: -90.3034000 },
  { name: "City Foundry STL",              category: "attractions", lat: 38.6330140,         lng: -90.2400266 },

  // Parking
  { name: "East End Garage",               category: "parking",     lat: 38.64658300567168,  lng: -90.30413496240332 },
  { name: "Millbrook Garage",              category: "parking",     lat: 38.65011610139658,  lng: -90.31173531215816 },
  { name: "WC Lower Lot",                  category: "parking",     lat: 38.64913858541001,  lng: -90.32852434288556, label: "West Campus Garage" },

  // Essentials (Lambert shown with nearest gas/pharmacy in the UI)
  { name: "Lambert Airport",               category: "essentials",  lat: 38.7486982,         lng: -90.3700257 },
];

// Candidate pools for the "nearest X" driving rows. Same idea as SHUTTLE_STOPS:
// the app scores candidates by proximity, routes the closest few, and stores the
// fastest under `resultName` (a synthetic `*_nearest` row in the locations table).
export const SCHNUCKS = [
  { name: "Schnucks (Richmond Center)",  lat: 38.6333967, lng: -90.3147569 },
  { name: "Schnucks (University City)",  lat: 38.6633689, lng: -90.3143234 },
  { name: "Schnucks (Ladue)",            lat: 38.6560300, lng: -90.3539800 },
  { name: "Schnucks (Hampton Village)",  lat: 38.5916169, lng: -90.2932513 },
];

export const PHARMACIES = [
  { name: "CVS (Delmar)",                   lat: 38.6557160, lng: -90.2999950 },
  { name: "CVS (Inside Target Brentwood)",  lat: 38.6279480, lng: -90.3434056 },
  { name: "Walgreens (Clayton & Big Bend)", lat: 38.6350307, lng: -90.3175023 },
  { name: "Walgreens (Delmar)",             lat: 38.6603240, lng: -90.3546910 },
];

export const GAS_STATIONS = [
  { name: "Amoco (Hi-Pointe)",            lat: 38.6334000, lng: -90.3043200 },
  { name: "Mobil (Clayton & Big Bend)",   lat: 38.6350117, lng: -90.3193634 },
  { name: "Phillips 66 (Big Bend & 64)",  lat: 38.6254000, lng: -90.3364000 },
  { name: "Shell (Maplewood Big Bend)",   lat: 38.6119948, lng: -90.3234102 },
  { name: "BP (Webster Groves Big Bend)", lat: 38.5835118, lng: -90.3579921 },
];

// `candidates` is the curated fallback pool. When `mapboxCategory` is set, the
// app first does a live Mapbox category search near the listing (finds the truly
// nearest station/pharmacy) and only falls back to `candidates` on empty/error.
// Schnucks has no `mapboxCategory`: the grocery category + text search are too
// noisy to reliably find "nearest Schnucks", so it always uses the curated pool.
export const NEAREST_DRIVE_POOLS = [
  { resultName: "schnucks_nearest",    label: "Nearest Schnucks",     category: "grocery",    candidates: SCHNUCKS },
  { resultName: "gas_station_nearest", label: "Nearest gas station",  category: "essentials", candidates: GAS_STATIONS, mapboxCategory: "gas_station" },
  { resultName: "pharmacy_nearest",    label: "Nearest pharmacy",     category: "essentials", candidates: PHARMACIES,   mapboxCategory: "pharmacy" },
];

// Display label for a stored drive-time row, by its locations-table name.
// Covers both fixed places and the synthetic nearest rows.
export const DRIVE_LABELS = Object.fromEntries([
  ...DRIVE_PLACES.map((p) => [p.name, p.label ?? p.name]),
  ...NEAREST_DRIVE_POOLS.map((p) => [p.resultName, p.label]),
]);
