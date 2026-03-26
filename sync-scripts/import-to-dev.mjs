/**
 * import-to-dev.mjs
 * Imports listings from properties.json into the dev MongoDB database.
 *
 * What it syncs:
 *   sync-scripts/properties.json
 *   → dev MongoDB "listings" collection (via /api/addListing endpoint)
 *   Geocodes each address via Mapbox before inserting.
 *   Requires the dev server to be running (uses the API route, not direct DB).
 *
 * Backend touched:
 *   - MongoDB dev cluster (MONGO_URI) → "listings" collection
 *   - Mapbox Directions API (NEXT_PUBLIC_MAPBOX_TOKEN) — for geocoding
 *
 * Usage:
 *   1. npm run dev           # start dev server first
 *   2. node sync-scripts/import-to-dev.mjs
 *
 * Note: For prod imports without a running server, use import-to-prod.mjs instead.
 */

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

const IMPORT_SECRET = process.env.IMPORT_SECRET;
const BASE_URL = process.env.IMPORT_BASE_URL || "http://localhost:3000";

if (!IMPORT_SECRET) { console.error("Missing IMPORT_SECRET in .env.local"); process.exit(1); }

// ── Load parsed properties ────────────────────────────────────────────────────
const propertiesPath = join(__dirname, "properties.json");
let listings;
try {
  const raw = readFileSync(propertiesPath, "utf8")
    .replace(/^\/\*[\s\S]*?\*\/\s*/m, ""); // strip leading /* comment */
  listings = JSON.parse(raw);
} catch (err) {
  console.error("Failed to parse properties.json:", err.message);
  console.error("Run `node sync-scripts/parse-properties-csv.mjs` first.");
  process.exit(1);
}

console.log(`Loaded ${listings.length} listings from properties.json`);

// ── Import each listing ───────────────────────────────────────────────────────
let succeeded = 0;
let failed = 0;

for (let i = 0; i < listings.length; i++) {
  const listing = listings[i];
  const label = `[${i + 1}/${listings.length}] ${listing.address}`;

  // lat/lng and walk times are computed by the addListing route
  const payload = { ...listing };

  try {
    const res = await fetch(`${BASE_URL}/api/addListing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-import-secret": IMPORT_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();

    if (!res.ok) {
      console.error(`  FAIL ${label}: ${res.status} — ${json.error}`);
      failed++;
    } else {
      console.log(`  OK   ${label} → ${json.listing?._id}`);
      succeeded++;
    }
  } catch (err) {
    console.error(`  FAIL ${label}: ${err.message}`);
    failed++;
  }
}

console.log(`\nDone: ${succeeded} succeeded, ${failed} failed`);
if (failed > 0) process.exit(1);
