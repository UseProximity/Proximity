/**
 * update-descriptions.mjs
 * ───────────────────────
 * Writes the canonical "description" field for every property in properties.json,
 * compiled from the Properties CSV (building amenities + notes/flags) and the
 * Units CSV (special features + per-unit notes).
 *
 * This script ONLY modifies the "description" key — nothing else is touched.
 *
 * Usage:
 *   node sync-scripts/update-descriptions.mjs            # update properties.json only
 *   node sync-scripts/update-descriptions.mjs --dev      # also push to local MongoDB (MONGO_URI_DEV)
 *   node sync-scripts/update-descriptions.mjs --prod     # also push to prod MongoDB (MONGO_URI_PROD)
 *   node sync-scripts/update-descriptions.mjs --dry-run  # preview changes, touch nothing
 */

import { readFileSync, writeFileSync } from "fs";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROPERTIES_PATH = join(__dirname, "properties.json");

// Load .env.local (same pattern as other sync scripts)
const envPath = resolve(process.cwd(), ".env.local");
const envVars = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      const raw = l.slice(i + 1).trim().replace(/^["']([^"']*)["'].*$/, "$1").replace(/\s+#.*$/, "");
      return [l.slice(0, i).trim(), raw];
    })
);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const PUSH_DEV = args.includes("--dev");
const PUSH_PROD = args.includes("--prod");

// ─────────────────────────────────────────────────────────────────
// NEW DESCRIPTIONS
// Key = exact "address" value as it appears in properties.json
// ─────────────────────────────────────────────────────────────────
const DESCRIPTIONS = {
  "6650 Delmar Blvd, St. Louis, MO 63130":
    "Brand new luxury building in The Delmar Loop with rooftop pool, hot tub, 24/7 fitness center, sauna, meditation rooms, study lounges, fire pits, co-working spaces, bike storage, package lockers, and co-living support. Per-bedroom leasing available — roommate matching offered. Fully furnished throughout. 2BR units: $1,344–$1,375/person/mo; 1BR suites: ~$1,049/person/mo; studios and 3BR suites also available (contact for pricing). Smart TV, stainless appliances, and hardwood-style plank floors in every unit. Private bathrooms in all 2BR+ layouts.",

  "6040 Kingsbury Ave, St. Louis, MO 63112":
    "Managed by Manor Real Estate, a long-established WashU-area landlord. 2BR/1BA units at 550 sqft — $698/person/mo with water, sewer, and trash included. Multiple units available at staggered dates (now through August 2026). Semester, academic-year, 12-month, and 2-year lease options available.",

  "6042 Kingsbury Ave, St. Louis, MO 63112":
    "Managed by Manor Real Estate, a long-established WashU-area landlord. 2BR/1BA units at 550 sqft — $698/person/mo with water, sewer, and trash included. Multiple units available at staggered dates (now through August 2026). Semester, academic-year, 12-month, and 2-year lease options available.",

  "727 Leland Ave, University City, MO 63130":
    "Professionally managed by Roberts Realty, right in the heart of the WashU student zone and on the WashU shuttle route. 3BR/1BA at 1,330 sqft — $665/person/mo. Large balcony off two bedrooms, gourmet kitchen with granite countertops and stainless appliances, hardwood floors, double-pane windows, central AC, free on-site laundry, off-street parking, secured entry, and fenced yard. Cats and small dogs welcome.",

  "6044 Washington Blvd, St. Louis, MO 63112":
    "Manor Real Estate portfolio property one block south of the Loop. 3BR/1BA at 1,200 sqft — $665/person/mo with sewer included. Flexible lease terms: 12-month, 2-year, academic year, and semester options available. Multiple units with staggered availability (May and August 2026).",

  "7325 Lindell Blvd, St. Louis, MO 63130":
    "Spacious 2BR/1BA at ~1,500 sqft — one of the largest 2-bedrooms in the WashU area — $1,000/person/mo with water, sewer, trash, and in-unit W/D included. Granite countertops, updated appliances, large eat-in kitchen, separate dining and study rooms, fenced backyard, and basement storage. Next to Colleen's Cafe. Quieter, less student-dense area than the Loop. Cats and small dogs welcome.",

  "7337 Dartmouth Ave, University City, MO 63130":
    "Professionally managed by Evernest. 2BR/1BA at 1,050 sqft — $573/person/mo. In-unit laundry hookups and garage parking included. Lawn care included in rent.",

  "735 Interdrive, University City, MO 63130":
    "Fully furnished 3BR/1BA at 1,450 sqft — $665/person/mo with water, sewer, and trash included. Everything pictured in the listing is included. Stainless appliances, hardwood floors, new carpet in bedrooms, central AC/heat, free on-site laundry, and off-street parking. No pets. Available immediately. Tenant pays gas and electric.",

  "7350 Lindell Blvd, St. Louis, MO 63130":
    "Private studio unit above Colleen's Cookies — $1,000/mo. Secure building with keyless entry. One of the closest listings to WashU campus (~8-min walk). International students welcome. Contact STL Rental to verify utilities and square footage.",

  "718 Limit Ave, University City, MO":
    "Fully furnished 3BR/1BA Mosaic property — $1,067/person/mo all-in with ALL utilities included (water, sewer, trash, internet, electric, and gas). Renovated open-concept chef's kitchen with quartz island and stainless appliances, large backyard, free in-unit laundry, secured front and back access, and 24/7 on-site maintenance. Owner is a licensed Missouri broker.",

  "725 Interdrive, University City, MO 63130":
    "Fully furnished 4BR/2BA Mosaic property — $900/person/mo (4 people) all-in with ALL utilities included (water, sewer, trash, internet, electric, and gas). Renovated open-concept chef's kitchen with quartz island and stainless appliances, double vanity bathroom, large backyard, completely updated building systems (new furnace, AC, plumbing, electric, and roof), secured front and back access, and 24/7 on-site maintenance. Note: separate property from 735 Interdrive. Availability TBD — confirm with Mosaic.",

  "733 Heman Ave, University City, MO 63130":
    "3-family building in the Loop — $500/person/mo with lawn care, snow removal, and sewer included. Community living, dining, and kitchen spaces shared across the building. Covered outdoor patio, free basement storage locker per unit, and direct access to the WashU bus line. Walking distance to restaurants, bars, and grocery.",

  "7326 Lindell Blvd, University City, MO 63130":
    "Spacious 2BR/1BA 2nd-floor unit at Lindell & Forsyth — very close to WashU campus — $1,100/person/mo with lawn care, snow removal, and sewer included. Private in-unit W/D, separate dining room, bonus home office room, large backyard great for BBQs, and lots of natural light. Note: listed by landlord alongside 733 Heman Ave but is a fully separate property.",

  "6044 Kingsbury Ave, St. Louis, MO 63112":
    "Charming 3BR/1BA walkable to campus — $800/person/mo with lawn care, snow removal, and sewer included. Generous-sized bedrooms, spacious living and dining room combo, and a beautiful kitchen. Available June 1, 2026. Note: different property from 6040–42 Kingsbury (Manor RE) despite the similar address.",

  "6219 Rosebury Ave, St. Louis, MO 63105":
    "Owner-operated quiet building tailored to academic-focused students — $1,198/person/mo (3rd floor 2BR/2BA, 1,000 sqft) with sewer, free basement storage, and bike storage included (heated garage parking +$175/mo). 12\"+ double-wythe masonry walls and concrete sub-floors deliver excellent sound isolation. 2025 Wi-Fi-enabled Bosch/LG/GE Profile appliances, private courtyard, smart automation upgrades available. 250 ft from Forest Park, close to med campus. Pet-friendly. Academic year and 12-month leases available.",

  "6221 Rosebury Ave, St. Louis, MO 63105":
    "Owner-operated quiet building tailored to academic-focused students — $1,198/person/mo (2nd floor 2BR/2BA, 1,000 sqft) with sewer, free basement storage, and bike storage included (heated garage parking +$175/mo). 12\"+ double-wythe masonry walls and concrete sub-floors deliver excellent sound isolation. 2025 Wi-Fi-enabled Bosch/LG/GE Profile appliances, private courtyard, smart automation upgrades available. 250 ft from Forest Park, close to med campus. Pet-friendly. Academic year and 12-month leases available.",

  "1173 Moorlands Ave, Richmond Heights, MO":
    "Just-rehabbed duplex in Richmond Heights — $800/person/mo. Two 2BR/1BA units available simultaneously from April 1, 2026. New appliances, modern bathroom, in-unit stacked laundry, new kitchens, closets, paint, flooring, and windows with lots of natural light. Charming character throughout. Further from main campus but closer to the med campus direction. $40 application fee (background + credit check) required.",

  "6707 Bartmer Ave, University City, MO 63130":
    "Excellent-value 3BR at $463/person/mo — two 2nd-floor units available at the same address. Hardwood floors, front and back porch, updated unit with appliances included. Sewer and lawn care included. Academic year and 12-month lease options available.",

  "6008 Washington Blvd, St. Louis, MO 63112":
    "Manor Real Estate portfolio property in Skinker-DeBaliviere. 3BR/1.5BA — the half-bath is a rare feature at this price point — $765/person/mo with sewer included. Flexible lease options: 12-month, 2-year, academic year, and semester. Available May 31, 2026. See manorrealestate.com for full details.",

  "6010 Washington Blvd, St. Louis, MO 63112":
    "Manor Real Estate portfolio property in Skinker-DeBaliviere. 3BR/1.5BA — the half-bath is a rare feature at this price point — $765/person/mo with sewer included. Flexible lease options: 12-month, 2-year, academic year, and semester. Available May 31, 2026. See manorrealestate.com for full details.",

  "6025 Kingsbury Ave, St. Louis, MO 63112":
    "Manor Real Estate portfolio property in Skinker-DeBaliviere. 3BR/2BA — two full bathrooms for a 3BR is rare at this price — $732/person/mo with sewer included. Flexible lease options: 12-month, 2-year, academic year, and semester. Available May 31, 2026. Adjacent to 6023 Kingsbury (same management).",

  "6023 Kingsbury Ave, St. Louis, MO 63112":
    "Manor Real Estate portfolio property in Skinker-DeBaliviere. 3BR/2BA — two full bathrooms for a 3BR — $732/person/mo with sewer included. Flexible lease options: 12-month, 2-year, academic year, and semester. Available May 31, 2026. Adjacent to 6025 Kingsbury (same management).",

  "6766 Corbitt Ave #1, University City, MO":
    "3BR unit #1 at $517/person/mo with washer and dryer included in unit. Pets welcome — small dogs and cats OK. Note: 2-year lease required. Available immediately.",

  "6805 Washington Ave, University City, MO 63130":
    "Quiet building policy enforced — ideal for focused students. 3BR/1BA at $725/person/mo with water, sewer, and trash included (tenant pays gas and electric). Beautiful hardwood floors, sunroom, dining room, central AC, dishwasher, intercom entry, cable/DSL ready, and off-street parking. $40/person credit check fee. Shown by appointment only. Cats welcome — NO DOGS. Available August 14, 2026.",

  "7453 Delmar Blvd Floor 1, Saint Louis, MO 63130":
    "Spacious 2BR/1BA at 1,500 sqft with private attached garage (remote access). Hardwood floors, central AC/heat, in-unit W/D, dishwasher, disposal, LED lighting, wood blinds, and ample closet and storage space. Water, sewer, trash, yard care, and maintenance all included. No smoking, no pets. $600 deposit. Price not listed — contact landlord directly.",

  "7463 Delmar Blvd #2W, Saint Louis, MO 63130":
    "2BR/1BA unit #2W with private attached garage (remote access). Hardwood floors, central AC, in-unit W/D, gas stove, dishwasher, disposal, LED lighting, wood blinds, and ample storage. Water, sewer, trash, yard care, and maintenance all included. No smoking, no pets. $600 deposit. Available April 1, 2026. Price not listed — contact landlord directly.",

  "5803 Waterman Blvd Unit 1E, St. Louis, MO 63112":
    "2BR/2BA at 1,432 sqft across from Forest Park — $925/person/mo. Granite countertops, in-unit stackable W/D, sunroom, carport, and a 50\" TV included at move-in. No security deposit required. No pets. $75/person background check. Verifiable gross monthly household income of $10,000 required.",

  "8400 Delmar Blvd, St. Louis, MO 63124":
    "Built 2023 luxury complex — 251 units across 6 stories. Studios to 3BRs available: studios ~$1,300–$1,775/mo, 1BRs ~$1,775–$2,325/mo (contact for current pricing). Flexible leases 3–48 months. Furnished units available. Smart fridges, smart locks, built-in speakers, valet trash, in-unit laundry, and private patio or balcony in every unit. Up to 2 months free (subject to terms). Pets welcome — dogs and cats, $40/mo per pet (max 2 each, $400 one-time fee). Utilities not included. $50 app fee, $100 permit fee, $400 booking fee.",

  "6249 Northwood Ave APT 2, Saint Louis, MO 63105":
    "Generous 3BR/2BA at 1,850 sqft in DeMun/Clayton — $798/person/mo. Building pays water, sewer, trash, and hot water (tenant pays gas and electric). Hardwood floors, central AC, ceiling fan, dishwasher, double-pane windows, private balcony, secured entry, fenced yard, dining room, sunroom, and private W/D in basement. No pets, non-smoking. Note: not in Clayton School District; fireplace is non-functioning.",

  "710 Westgate Ave #1, Saint Louis, MO 63130":
    "Classic 1925 building — 3BR/1BA at 1,564 sqft — $700/person/mo. Building pays water, sewer, and trash (tenant pays gas and electric). Updated kitchen with quartz counters, under-cabinet lighting, and stainless appliances. Hardwood floors, central AC, dishwasher, double-pane windows, in-unit W/D, secured entry, dining room, and off-street rear parking. Cats and small dogs welcome. Non-smoking. Available immediately.",

  "739 Leland Ave #1, Saint Louis, MO 63130":
    "3BR/1BA at 1,450 sqft in the University City Loop — $665/person/mo. Hardwood floors, central AC, ceiling fan, dishwasher, microwave, double-pane windows, and breakfast nook. Free shared laundry in the basement and off-street parking included. Pets under 45 lbs welcome ($250 deposit + $40/mo pet rent). Non-smoking. Available June 1, 2026.",

  "6651 Kingsbury Blvd APT 1W, Saint Louis, MO 63130":
    "3BR/1BA at 1,400 sqft in the University City Loop — $1,098/person/mo. In-unit W/D, off-street parking, hardwood floors, central AC, ceiling fan, dishwasher, microwave, double-pane windows, and dining room. No pets, non-smoking. Fixed lease term: June 1, 2026 – May 31, 2027.",

  "6629 Kingsbury Blvd APT 2W, Saint Louis, MO 63130":
    "Large 3BR/1BA at 1,744 sqft in the University City Loop — $1,000/person/mo. Building pays water, sewer, trash, and hot water (tenant pays gas and electric). South-facing unit with lots of natural light. Free shared laundry in basement, off-street parking, and hardwood floors. No pets. Available June 1, 2026.",

  "608 Kingsland Ave, St. Louis, MO 63130":
    "Boutique 4BR/4BA suite building — 12 units total (4 per floor). Each bedroom has a private ensuite bath with floor-to-ceiling marble and rain shower, personal kitchenette, and individual climate control. Shared chef's kitchen with granite countertops and stainless appliances, resident lounges (TV, bar seating, ping pong, pool table), landscaped courtyard, large balconies on every floor, and sound-insulated windows. Pricing: $1,000/person/mo (12-month), $1,200/person/mo (10-month), or $9,900/person for semester lease. Per-bedroom or whole-suite leases accepted. Campus shuttle stop at the doorstep.",
};

// ─────────────────────────────────────────────────────────────────
// 1. Update properties.json
// ─────────────────────────────────────────────────────────────────
const raw = readFileSync(PROPERTIES_PATH, "utf8");
const properties = JSON.parse(raw.replace(/^\/\*[\s\S]*?\*\/\s*/, ""));

const changed = [];
for (const prop of properties) {
  const next = DESCRIPTIONS[prop.address];
  if (!next) continue;
  if (prop.description !== next) {
    changed.push({ address: prop.address, old: prop.description, next });
    if (!DRY_RUN) prop.description = next;
  }
}

if (DRY_RUN) {
  console.log(`\n[DRY RUN] ${changed.length} description(s) would change:\n`);
  for (const c of changed) {
    console.log(`  • ${c.address}`);
    console.log(`    OLD: ${c.old?.slice(0, 80)}…`);
    console.log(`    NEW: ${c.next.slice(0, 80)}…\n`);
  }
} else {
  // Preserve the JS comment header
  const header = `/**\n * Paste one or more documents here\n */\n`;
  writeFileSync(PROPERTIES_PATH, header + JSON.stringify(properties, null, 2));
  console.log(`✅ properties.json updated — ${changed.length} description(s) changed.`);
  for (const c of changed) console.log(`   • ${c.address}`);
}

// ─────────────────────────────────────────────────────────────────
// 2. Optionally push to MongoDB
// ─────────────────────────────────────────────────────────────────
async function pushToMongo(envVar, label) {
  const uri = envVars[envVar];
  if (!uri) {
    console.error(`\n❌ ${envVar} not found in .env.local. Skipping ${label} push.`);
    return;
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const col = db.collection(envVars.LISTINGS_COLLECTION || "listings");

    let updated = 0;
    let notFound = 0;

    // Push ALL descriptions — not just the ones that changed in this run
    for (const [address, description] of Object.entries(DESCRIPTIONS)) {
      if (DRY_RUN) {
        const doc = await col.findOne({ address });
        console.log(`  [${label}] ${address} → ${doc ? "found" : "NOT FOUND"}`);
        continue;
      }
      const res = await col.updateOne({ address }, { $set: { description } });
      if (res.matchedCount === 0) {
        console.warn(`  ⚠️  [${label}] No listing found for: ${address}`);
        notFound++;
      } else {
        updated++;
      }
    }

    if (!DRY_RUN)
      console.log(`✅ [${label}] ${updated} listing(s) updated, ${notFound} not found.`);
  } finally {
    await client.close();
  }
}

if (PUSH_DEV || PUSH_PROD) {
  if (PUSH_DEV) await pushToMongo("MONGO_URI_DEV", "DEV");
  if (PUSH_PROD) await pushToMongo("MONGO_URI_PROD", "PROD");
}
