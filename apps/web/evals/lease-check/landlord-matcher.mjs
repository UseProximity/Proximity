/*
 * Unit eval for the LLM landlord/company matcher (the Haiku filter in
 * src/lib/leaseCheck/propertyContext.js -> filterCandidatesWithModel).
 *
 * It feeds synthetic candidate listings and asserts the model keeps the ones that truly
 * belong to the typed company (by contact name, by email DOMAIN derived from the name,
 * and by landlord-account email) and rejects coincidental/generic matches. This tests
 * the matcher's judgment in isolation; the DB retrieval that feeds it real candidates is
 * only exercised end-to-end on staging.
 *
 * Requires LEASE_SCANNER_KEY. Run:
 *   cd apps/web && set -a && source .env.local && set +a && node scripts/lease-check-eval/landlord-matcher.mjs
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(WEB + "package.json");
const Anthropic = require("@anthropic-ai/sdk");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const { z } = require("zod");

if (!process.env.LEASE_SCANNER_KEY) {
  console.error("LEASE_SCANNER_KEY not set. Run: set -a && source .env.local && set +a");
  process.exit(2);
}

// Mirror of MATCHER_SYSTEM in propertyContext.js — keep in lockstep.
const MATCHER_SYSTEM = `You match a landlord or property-management company name (typed by a student) against candidate rental listings. Return the ids of listings that clearly belong to that company.

A listing belongs if any of these hold:
- Its contact name is that company (including abbreviations, "The X Company" vs "X", suffix differences like LLC/Properties/Management).
- Its contact email's domain is derived from the company name (e.g. "Clocktower" matches max@clocktowerstl.com or leasing@theclocktowercompany.com).
- Its landlord account name or email matches the same way.

Rules:
- Generic mail domains (gmail, yahoo, outlook, hotmail, icloud, aol) prove nothing by themselves; for those, require the name or the email's local part to match the company.
- A shared generic word is not a match ("City Properties" does not match "City Lights Apartments").
- When unsure, EXCLUDE. A wrong match shows a student someone else's reviews, which is worse than showing nothing.`;

const LandlordMatchSchema = z.object({ matchingListingIds: z.array(z.string()) });

const SCENARIOS = [
  {
    query: "Clocktower",
    candidates: [
      { id: "name", title: "6633 Clemens Ave", contactName: "The Clocktower Company", contactEmail: "leasing@gmail.com", landlordAccount: null },
      { id: "domain", title: "7200 Forsyth Blvd", contactName: "Max S.", contactEmail: "max@clocktowerstl.com", landlordAccount: null },
      { id: "account", title: "6100 Pershing Ave", contactName: null, contactEmail: null, landlordAccount: { name: "Max Sassouni", email: "max@theclocktowercompany.com" } },
      { id: "no_diff_owner", title: "Clocktower Lofts (different owner)", contactName: "Gateway Loop Properties LLC", contactEmail: "info@gatewayloopstl.com", landlordAccount: null },
      { id: "no_generic_gmail", title: "6820 Waterman Ave", contactName: "J. Smith Rentals", contactEmail: "jsmithrentals@gmail.com", landlordAccount: null },
    ],
    expect: { name: true, domain: true, account: true, no_diff_owner: false, no_generic_gmail: false },
  },
  {
    query: "Gateway Loop",
    candidates: [
      { id: "g_name", title: "A", contactName: "Gateway Loop Properties LLC", contactEmail: "info@gatewayloopstl.com", landlordAccount: null },
      { id: "g_generic", title: "B", contactName: "Gateway Dental Clinic", contactEmail: "front@gatewaydental.com", landlordAccount: null },
      { id: "g_partial", title: "C", contactName: "Loop Living Co", contactEmail: "hi@loopliving.com", landlordAccount: null },
    ],
    expect: { g_name: true, g_generic: false, g_partial: false },
  },
];

const client = new Anthropic({ apiKey: process.env.LEASE_SCANNER_KEY });

async function matchOne(scenario) {
  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 1000,
    output_config: { format: zodOutputFormat(LandlordMatchSchema) },
    system: [{ type: "text", text: MATCHER_SYSTEM }],
    messages: [{ role: "user", content: `Company the student typed: "${scenario.query}"\n\nCandidates:\n${JSON.stringify(scenario.candidates, null, 2)}` }],
  });
  const ids = response.parsed_output?.matchingListingIds ?? [];
  const rows = Object.entries(scenario.expect).map(([id, want]) => {
    const got = ids.includes(id);
    return { id, want, got, ok: got === want };
  });
  return { query: scenario.query, matched: ids, rows, ok: rows.every((r) => r.ok) };
}

const results = await Promise.all(SCENARIOS.map(matchOne));
let fails = 0;
for (const r of results) {
  console.log(`\n"${r.query}" -> ${JSON.stringify(r.matched)}`);
  for (const row of r.rows) {
    if (!row.ok) fails++;
    console.log(`  ${row.ok ? "✓" : "✗"} ${row.id}: expected ${row.want ? "match" : "no match"}, got ${row.got ? "match" : "no match"}`);
  }
}
console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`}`);
process.exit(fails === 0 ? 0 : 1);
