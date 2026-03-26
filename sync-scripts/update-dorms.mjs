/**
 * update-dorms.mjs
 * Updates room type and description fields for all dorms in the database.
 *
 * What it does:
 *   Applies a hardcoded set of updates (roomTypes, description) to dorm
 *   documents matched by name. Used to patch dorm metadata without a full reseed.
 *
 * Backend touched:
 *   - MongoDB cluster (MONGO_URI env var) → "dorms" collection — updates fields
 *
 * Usage:
 *   Dev:  MONGO_URI="mongodb+srv://..." node sync-scripts/update-dorms.mjs
 *   Prod: MONGO_URI="<prod-uri>"        node sync-scripts/update-dorms.mjs
 *   (MONGO_URI must be passed as an env var — this script does not load .env.local)
 */

import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error("Missing MONGO_URI"); process.exit(1); }

const updates = [
  {
    name: "Beaumont",
    roomTypes: ["Traditional Single", "Traditional Double", "Traditional Triple"],
    description: "Traditional rooms with Singles, Doubles, and Triples",
  },
  {
    name: "Danforth",
    roomTypes: ["Modern Double"],
    description: "Modern suites with Doubles",
  },
  {
    name: "Dardick",
    roomTypes: ["Modern Double"],
    description: "Modern suites with Doubles",
  },
  {
    name: "Dauten",
    roomTypes: ["Traditional Single", "Traditional Double"],
    description: "Traditional suites with Singles and Doubles (6 people)",
  },
  {
    name: "Eliot A",
    roomTypes: ["Modern Single", "Modern Double"],
    description: "Modern suites with Singles and Doubles",
  },
  {
    name: "Eliot B",
    roomTypes: ["Modern Single", "Modern Double"],
    description: "Modern suite with Singles and Doubles",
  },
  {
    name: "Gregg",
    roomTypes: ["Modern Single", "Modern Double"],
    description: "Modern suite with Singles and Doubles (2 people)",
  },
  {
    name: "Hitzeman",
    roomTypes: ["Traditional Single", "Traditional Double"],
    description: "Traditional suite with Singles and Doubles (4 people)",
  },
  {
    name: "Hurd",
    roomTypes: ["Traditional Single", "Traditional Double"],
    description: "Traditional suites with Singles and Doubles (6 people)",
  },
  {
    name: "Koenig",
    roomTypes: ["Modern Double", "Modern Triple"],
    description: "Modern suites with Doubles and Triples",
  },
  {
    name: "Lee",
    roomTypes: ["Traditional Double", "Traditional Triple"],
    description: "Traditional rooms with Doubles and Triples",
  },
  {
    name: "Lien",
    roomTypes: ["Modern Double"],
    description: "Modern suites with Doubles",
  },
  {
    name: "Liggett",
    roomTypes: ["Modern Single"],
    description: "Modern suite with Singles",
  },
  {
    name: "Millbrook",
    roomTypes: ["Apartment Style"],
    description: "Modern apartments with singles (3-8 singles per apartment)",
  },
  {
    name: "Mudd",
    roomTypes: ["Modern Single", "Modern Double"],
    description: "Modern suite with Singles and Doubles",
  },
  {
    name: "Myers",
    roomTypes: ["Traditional Single", "Traditional Double"],
    description: "Traditional suite with Singles and Doubles (4 people)",
  },
  {
    name: "Nemerov",
    roomTypes: ["Modern Single"],
    description: "Modern suite with Singles",
  },
  {
    name: "Park",
    roomTypes: ["Modern Double"],
    description: "Modern suites with Doubles (6 people)",
  },
  {
    name: "Rosedale Apartments",
    roomTypes: ["Apartment Style"],
    description: "Mix apartments with 1-2 singles",
  },
  {
    name: "Rutledge",
    roomTypes: ["Traditional Single", "Traditional Double"],
    description: "Traditional suite with Singles and Doubles",
  },
  {
    name: "Shanedling",
    roomTypes: ["Traditional Single", "Traditional Double"],
    description: "Traditional suite with Singles and Doubles",
  },
  {
    name: "Shepley",
    roomTypes: ["Modern Single"],
    description: "Modern suite with Singles",
  },
  {
    name: "SoFoHo",
    roomTypes: ["Modern Single"],
    description: "Modern suite with Singles",
  },
  {
    name: "The Lofts",
    roomTypes: ["Apartment Style"],
    description: "Modern apartments with 3 singles (Limited 2 person and 1 person apartments available)",
  },
  {
    name: "Umrath",
    roomTypes: ["Modern Double", "Modern Triple"],
    description: "Modern suites with Doubles and Triples",
  },
  {
    name: "University Drive",
    roomTypes: ["Apartment Style"],
    description: "Modern apartments with 3 singles (One 2 bedroom, one 4 bedroom)",
  },
  {
    name: "Village & Lopata House",
    roomTypes: ["Modern Single"],
    description: "Modern suites with 4 singles",
  },
  {
    name: "Village East",
    roomTypes: ["Apartment Style"],
    description: "Modern apartments with 4 singles",
  },
  {
    name: "Washington Ave Apartments",
    roomTypes: ["Apartment Style"],
    description: "Modern apartments with 1-3 singles",
  },
  {
    name: "Wheeler",
    roomTypes: ["Modern Single", "Modern Double"],
    description: "Modern suite with Singles and Doubles",
  },
  {
    name: "520 Kingsland",
    roomTypes: ["Apartment Style"],
    description: "Modern apartments with 3 singles and 3 bathrooms",
  },
  {
    name: "Greenway Apartments",
    roomTypes: ["Apartment Style"],
    description: "Modern apartments and townhomes with singles (1-3 singles per suite)",
  },
];

const client = new MongoClient(MONGO_URI);
await client.connect();
const col = client.db().collection("dorms");

let updated = 0;
for (const { name, roomTypes, description } of updates) {
  const result = await col.updateOne(
    { name },
    { $set: { roomTypes, description } }
  );
  if (result.matchedCount === 0) {
    console.log(`⚠️  Not found: ${name}`);
  } else {
    console.log(`✓  ${name}`);
    updated++;
  }
}

await client.close();
console.log(`\nDone. Updated ${updated}/${updates.length} dorms.`);
