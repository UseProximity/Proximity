/**
 * seed-dorm-reviews.mjs
 * Seeds hardcoded dorm reviews into the dorms collection.
 *
 * What it does:
 *   Inserts a predefined set of WashU student dorm reviews into the
 *   "dorms" collection. Used to populate initial review data.
 *
 * Backend touched:
 *   - MongoDB cluster (MONGO_URI env var) → "dorms" collection — inserts reviews
 *
 * Usage:
 *   Dev:  MONGO_URI="mongodb+srv://..." node sync-scripts/seed-dorm-reviews.mjs
 *   Prod: MONGO_URI="<prod-uri>"        node sync-scripts/seed-dorm-reviews.mjs
 *   (MONGO_URI must be passed as an env var — this script does not load .env.local)
 */
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("Missing MONGO_URI env var");
  process.exit(1);
}

const reviews = [
  { name: "Adrian",   classYear: 2028, rating: 5, dorm: "Beaumont",             dormType: "Modern Double",       tags: ["On-Campus", "Quiet Floor"],      content: "Spacious dorm, great natural light, but noisy at night." },
  { name: "Sophie",   classYear: 2027, rating: 5, dorm: "Danforth",             dormType: "Traditional Single",  tags: ["On-Campus", "Quiet Floor"],      content: "Super cozy and clean dorm, would recommend." },
  { name: "Marcus",   classYear: 2026, rating: 4, dorm: "Dardick",              dormType: "Modern Single",       tags: ["On-Campus", "Study Floor"],      content: "Great location and modern amenities. The rooms are a bit small but well-designed." },
  { name: "Emma",     classYear: 2028, rating: 5, dorm: "Dardick",              dormType: "Traditional Double",  tags: ["On-Campus", "Social Floor"],     content: "Love the community here! Close to dining and great study spaces." },
  { name: "James",    classYear: 2027, rating: 4, dorm: "Dauten",               dormType: "Modern Single",       tags: ["On-Campus", "Quiet Floor"],      content: "Perfect for studying, very quiet and clean. Great views from upper floors." },
  { name: "Sarah",    classYear: 2026, rating: 5, dorm: "Eliot A",              dormType: "Traditional Double",  tags: ["On-Campus", "Historic"],         content: "Classic WashU experience! Beautiful architecture and great sense of community." },
  { name: "Alex",     classYear: 2028, rating: 4, dorm: "Eliot A",              dormType: "Traditional Single",  tags: ["On-Campus", "Historic"],         content: "Love the traditional feel and central location on campus." },
  { name: "Maya",     classYear: 2027, rating: 5, dorm: "Hurd",                 dormType: "Modern Double",       tags: ["On-Campus", "New Building"],     content: "Brand new facilities with amazing amenities. Highly recommend!" },
  { name: "David",    classYear: 2026, rating: 4, dorm: "Koenig",               dormType: "Traditional Single",  tags: ["On-Campus", "Social Floor"],     content: "Great social atmosphere and close to everything. Rooms are decent size." },
  { name: "Rachel",   classYear: 2028, rating: 5, dorm: "Lee",                  dormType: "Modern Single",       tags: ["On-Campus", "Quiet Floor"],      content: "Perfect for focused studying. Modern facilities and very clean." },
  { name: "Tyler",    classYear: 2027, rating: 4, dorm: "Lien",                 dormType: "Traditional Double",  tags: ["On-Campus", "Study Floor"],      content: "Good location and solid amenities. Would live here again." },
  { name: "Jessica",  classYear: 2026, rating: 5, dorm: "Park",                 dormType: "Modern Double",       tags: ["On-Campus", "Social Floor"],     content: "Amazing community and beautiful common areas. Best dorm experience!" },
  { name: "Chris",    classYear: 2028, rating: 4, dorm: "Umrath",               dormType: "Traditional Single",  tags: ["On-Campus", "Central Location"], content: "Super convenient location. Easy access to classes and dining." },
  { name: "Lauren",   classYear: 2027, rating: 5, dorm: "Eliot B",              dormType: "Traditional Double",  tags: ["On-Campus", "Historic"],         content: "Love the historic charm and tight-knit community feel." },
  { name: "Kevin",    classYear: 2026, rating: 4, dorm: "Gregg",                dormType: "Modern Single",       tags: ["On-Campus", "Quiet Floor"],      content: "Great for studying and very peaceful. Modern renovations are nice." },
  { name: "Ashley",   classYear: 2028, rating: 5, dorm: "Hitzeman",             dormType: "Traditional Double",  tags: ["On-Campus", "Social Floor"],     content: "Best social life on campus! Love my floormates and the atmosphere." },
  { name: "Brandon",  classYear: 2027, rating: 4, dorm: "Liggett",              dormType: "Modern Single",       tags: ["On-Campus", "Study Floor"],      content: "Perfect for academics. Quiet environment and good study spaces." },
  { name: "Megan",    classYear: 2026, rating: 5, dorm: "Mudd",                 dormType: "Traditional Single",  tags: ["On-Campus", "Central Location"], content: "Great location and friendly community. Would definitely recommend." },
  { name: "Nathan",   classYear: 2028, rating: 4, dorm: "Myers",                dormType: "Modern Double",       tags: ["On-Campus", "New Building"],     content: "Modern amenities and spacious rooms. Great common areas too." },
  { name: "Olivia",   classYear: 2027, rating: 5, dorm: "Nemerov",              dormType: "Traditional Single",  tags: ["On-Campus", "Quiet Floor"],      content: "Perfect for writers and artists. Very inspiring and peaceful environment." },
  { name: "Jordan",   classYear: 2026, rating: 4, dorm: "Rutledge",             dormType: "Traditional Double",  tags: ["On-Campus", "Historic"],         content: "Classic dorm experience with great traditions and community events." },
  { name: "Samantha", classYear: 2028, rating: 5, dorm: "Shanedling",           dormType: "Modern Single",       tags: ["On-Campus", "Study Floor"],      content: "Excellent for academics and personal growth. Very supportive community." },
  { name: "Eric",     classYear: 2027, rating: 4, dorm: "Shepley",              dormType: "Traditional Double",  tags: ["On-Campus", "Social Floor"],     content: "Great social atmosphere and convenient location. Really enjoyed living here." },
  { name: "Amanda",   classYear: 2026, rating: 5, dorm: "SoFoHo",               dormType: "Modern Single",       tags: ["On-Campus", "Apartment Style"],  content: "Best of both worlds - independence with campus community. Love the setup!" },
  { name: "Michael",  classYear: 2028, rating: 4, dorm: "Wheeler",              dormType: "Traditional Single",  tags: ["On-Campus", "Quiet Floor"],      content: "Great for focused study and personal reflection. Very peaceful environment." },
  { name: "Nicole",   classYear: 2027, rating: 5, dorm: "Greenway Apartments",  dormType: "Apartment Style",     tags: ["Off-Campus", "Independent Living"], content: "Perfect transition to independent living while staying connected to campus." },
  { name: "Ryan",     classYear: 2026, rating: 4, dorm: "Millbrook",            dormType: "Apartment Style",     tags: ["Off-Campus", "Quiet"],           content: "Great for upperclassmen. Good balance of independence and community." },
  { name: "Hannah",   classYear: 2028, rating: 5, dorm: "University Drive",     dormType: "Apartment Style",     tags: ["Off-Campus", "Modern"],          content: "Modern apartments with great amenities. Perfect for junior/senior year." },
  { name: "Zach",     classYear: 2027, rating: 4, dorm: "Village East",         dormType: "Apartment Style",     tags: ["Off-Campus", "Social"],          content: "Great community feel even though it's off-campus. Really enjoyed it." },
];

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log("Connected to MongoDB");

  const db = client.db();
  const collection = db.collection("dormreviews");

  const existing = await collection.countDocuments();
  if (existing > 0) {
    console.log(`Collection already has ${existing} documents. Skipping seed to avoid duplicates.`);
    console.log("Delete existing documents first if you want to re-seed.");
    await client.close();
    return;
  }

  const docs = reviews.map((r) => ({ ...r, createdAt: new Date(), updatedAt: new Date() }));
  const result = await collection.insertMany(docs);
  console.log(`Inserted ${result.insertedCount} dorm reviews`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
