/**
 * fetch-listings.mjs
 * Exports all listings from the dev database to a local JSON file.
 *
 * What it does:
 *   Reads every document from the dev "listings" collection and writes
 *   sync-scripts/listings.json in MongoDB Compass paste format for inspection.
 *
 * Backend touched:
 *   - MongoDB dev cluster (MONGO_URI) → "listings" collection — read-only
 *   - sync-scripts/listings.json on disk — overwritten on each run
 *
 * Usage:
 *   node sync-scripts/fetch-listings.mjs
 */

import { MongoClient } from "mongodb";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
const envPath = join(__dirname, "../.env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, "");
}

const outPath = join(__dirname, "listings.json");

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error("Missing MONGO_URI env var"); process.exit(1); }

const client = new MongoClient(MONGO_URI);
await client.connect();

const db = client.db();
const listings = await db.collection("parsed-listings").find({}).sort({ address: 1 }).toArray();

await client.close();

if (listings.length === 0) {
  console.log("No listings found in collection.");
  process.exit(0);
}

const docs = listings
  .map(l => JSON.stringify(l, null, 2))
  .join(",\n");

const output = `/**\n * Paste one or more documents here\n */\n[\n${docs}\n]`;

writeFileSync(outPath, output, "utf8");
console.log(`Fetched ${listings.length} listings → ${outPath}`);
