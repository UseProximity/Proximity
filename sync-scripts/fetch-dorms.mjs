/**
 * fetch-dorms.mjs
 * Prints a summary of all dorm documents from the dev database.
 *
 * What it does:
 *   Reads every document from the "dorms" collection and logs a formatted
 *   table to the console. Useful for inspecting dorm data without Compass.
 *
 * Backend touched:
 *   - MongoDB dev cluster (MONGO_URI) → "dorms" collection — read-only
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://..." node sync-scripts/fetch-dorms.mjs
 *   (or set MONGO_URI in your shell environment — does not load .env.local)
 */

import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error("Missing MONGO_URI"); process.exit(1); }

const client = new MongoClient(MONGO_URI);
await client.connect();

const db = client.db();
const dorms = await db.collection("dorms").find({}).sort({ name: 1 }).toArray();

await client.close();

if (dorms.length === 0) {
  console.log("No dorms found in collection.");
  process.exit(0);
}

// Pretty table summary
console.log("\n=== DORMS COLLECTION (" + dorms.length + " documents) ===\n");
for (const d of dorms) {
  console.log(`NAME:       ${d.name}`);
  console.log(`ROOM TYPES: ${d.roomTypes?.join(", ") || "(empty)"}`);
  console.log(`TAGS:       ${d.tags?.join(", ") || "(empty)"}`);
  console.log(`IMAGE:      ${d.image || "(null)"}`);
  console.log("---");
}

// Clean JSON for pasting (strips _id and timestamps)
const clean = dorms.map(({ name, roomTypes, tags, image }) => ({
  name,
  roomTypes: roomTypes ?? [],
  tags: tags ?? [],
  image: image ?? null,
}));

console.log("\n=== PASTE-READY JSON ===\n");
console.log(JSON.stringify(clean, null, 2));
