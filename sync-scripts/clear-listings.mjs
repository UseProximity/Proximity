/**
 * clear-listings.mjs
 * Deletes ALL documents from the dev listings collection. IRREVERSIBLE.
 *
 * What it does:
 *   Wipes every document in the "listings" collection on the dev database.
 *   Use before a fresh import to avoid duplicate/stale listings.
 *
 * Backend touched:
 *   - MongoDB dev cluster (MONGO_URI) → "listings" collection — destructive delete
 *
 * Usage:
 *   node sync-scripts/clear-listings.mjs
 *
 * WARNING: This only targets the dev DB (MONGO_URI). Never point MONGO_URI at prod
 *          before running this script.
 */

import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, "../.env.local"), "utf8").split("\n")) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, "");
}

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const result = await client.db().collection("listings").deleteMany({});
await client.close();
console.log(`Deleted ${result.deletedCount} listings.`);
