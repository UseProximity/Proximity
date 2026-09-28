/*
 * Pretty-printer for the deterministic edge-case probe (/api/dev/matchmaking-edgecases).
 * Verifies the group-fit work: groups under 5 must fit in ONE unit, groups of 5+
 * may take a FLUSH multi-unit combo (units summing exactly to the headcount), the
 * honest group note, persistent exclude-set, and the "cheaper than <listing>"
 * follow-up. A "SPLIT" row for a group under 5 is a bug.
 *
 * Usage:  npm run dev   (one terminal)   then   node scripts/matchmaking-edgecases.mjs
 */
const BASE = process.argv[2] || "http://localhost:3000";
const URL = `${BASE.replace(/\/$/, "")}/api/dev/matchmaking-edgecases`;

const res = await fetch(URL).catch((e) => {
  console.error(`\nCould not reach ${URL} — is the dev server running?\n`, e.message);
  process.exit(1);
});
if (!res.ok) {
  console.error(`\n${URL} returned ${res.status}.\n`);
  process.exit(1);
}
const data = await res.json();
const short = (s) => (s || "—").slice(0, 22).padEnd(22);
const fmtPick = (x) =>
  `${x.backfilled ? "BACK " : x.unit_split ? "SPLIT" : "1unit"} ${short(x.title)} $${String(x.per_person ?? "—").padStart(4)}  ${String(x.intention).padEnd(18)} [unit≤${x.max_unit_beds}b units ${(x.unit_beds ?? []).join("+") || "—"}]`;

console.log(`\n=== EDGE-CASE DETERMINISTIC PICKS  (corpus: ${data.corpus.fetched} listings) ===\n`);
for (const r of data.results) {
  console.log(`● ${r.label}`);
  console.log(`   group=${r.parsed_group_size}  budget=${r.budget_max ?? "none"}  pool=${r.poolSize}  backfilled=${r.backfilledCount ?? 0}`);
  if (r.picks.length === 0) console.log(`   (no picks)`);
  r.picks.forEach((x, i) => console.log(`   ${i + 1}. ${fmtPick(x)}`));
  if (r.groupNote) console.log(`   ⚑ NOTE: ${r.groupNote}`);
  for (const f of r.followups) {
    console.log(`   ↳ follow-up: ${f.kind}`);
    if ("still_present" in f) console.log(`      rejected still present? ${f.still_present ? "❌ YES (BUG)" : "✅ no"}`);
    if ("max_per_person_after" in f) console.log(`      max $/person after = $${f.max_per_person_after}`);
    f.picks.forEach((x, i) => console.log(`      ${i + 1}. ${fmtPick(x)}`));
    if (f.groupNote) console.log(`      ⚑ NOTE: ${f.groupNote}`);
  }
  console.log("");
}
