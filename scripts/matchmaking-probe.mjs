/*
 * Matchmaking bias report — reusable test runner.
 *
 * Measures whether the proxy-chat matchmaker personalizes its recommendations or
 * hands everyone the same listing. It hits the dev-only probe endpoint
 * (/api/dev/matchmaking-probe), which runs ~24 deliberately-divergent personas
 * through the real ranking path, then prints:
 *   - corpus coverage (price spread, reviews/amenities/walk-time availability)
 *   - #1 "Best overall match" concentration  (1 distinct pick = fully biased)
 *   - top-3 universal favorites
 *   - personalization sensitivity (does changing the lead priority change picks?)
 *
 * Usage:
 *   1) npm run dev          # in one terminal (dev DB = prod snapshot)
 *   2) node scripts/matchmaking-probe.mjs [baseUrl]   # default http://localhost:3000
 *
 * Re-run after any ranking change to compare before/after. No retest rebuild.
 */
const BASE = process.argv[2] || process.env.PROBE_BASE_URL || "http://localhost:3000";
const URL = `${BASE.replace(/\/$/, "")}/api/dev/matchmaking-probe`;

const short = (s) => (s || "—").replace(/ (Avenue|Boulevard|Place|Street|Drive|Ave|Blvd)\b.*/, "").slice(0, 18);
const pct = (n, d) => `${((100 * n) / d).toFixed(0)}%`;

const res = await fetch(URL).catch((e) => {
  console.error(`\nCould not reach ${URL}\nIs the dev server running? (npm run dev)\n`, e.message);
  process.exit(1);
});
if (!res.ok) {
  console.error(`\n${URL} returned ${res.status}. (In production the probe is disabled by design.)\n`);
  process.exit(1);
}
const data = await res.json();
const R = data.results.filter((r) => !r.error);
const errs = data.results.filter((r) => r.error);

const c = data.corpus;
console.log(`\n=== CORPUS (live candidate set) ===`);
console.log(`active listings: ${c.totalActive} | priced: ${c.priced}`);
console.log(`price/person: $${c.priceQuartiles?.min} … p25 $${c.priceQuartiles?.p25} … median $${c.priceQuartiles?.median} … p75 $${c.priceQuartiles?.p75} … $${c.priceQuartiles?.max}`);
console.log(`data coverage → reviews ${c.withReviews}/${c.totalActive} | amenities ${c.withAnyAmenity}/${c.totalActive} | campus-walk ${c.withCampusWalk} | med-walk ${c.withMedWalk} | grocery-walk ${c.withGroceryWalk}`);

// ── #1 concentration ─────────────────────────────────────────────────────────
const top1 = {};
for (const p of R) { const t = p.picks[0]; if (t) top1[t.listing_id] = (top1[t.listing_id] || 0) + 1; }
const title = Object.fromEntries(R.flatMap((p) => p.picks.map((x) => [x.listing_id, x.title])));
console.log(`\n=== #1 "BEST OVERALL MATCH" CONCENTRATION  (${R.length} personas) ===`);
Object.entries(top1).sort((a, b) => b[1] - a[1]).forEach(([id, n]) =>
  console.log(`  ${String(n).padStart(2)}  ${pct(n, R.length).padStart(4)}  ${short(title[id]).padEnd(20)} ${id.slice(0, 8)}`));
console.log(`  → distinct #1 picks: ${Object.keys(top1).length} of ${R.length}  ${Object.keys(top1).length === 1 ? "  ⚠️  FULLY BIASED (one listing wins everything)" : ""}`);

// ── universal favorites ──────────────────────────────────────────────────────
const any = {};
for (const p of R) for (const x of p.picks) any[x.listing_id] = (any[x.listing_id] || 0) + 1;
console.log(`\n=== TOP-3 UNIVERSAL FAVORITES (appears in N personas' top-3) ===`);
Object.entries(any).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([id, n]) =>
  console.log(`  ${String(n).padStart(2)}  ${pct(n, R.length).padStart(4)}  ${short(title[id]).padEnd(20)} ${id.slice(0, 8)}`));
console.log(`  → distinct listings ever recommended: ${Object.keys(any).length}  (corpus priced: ${c.priced})`);

// ── intention coverage (did Most amenities / Best reviews actually appear?) ──
const intents = {};
for (const p of R) for (const x of p.picks) intents[x.intention] = (intents[x.intention] || 0) + 1;
console.log(`\n=== INTENTION LABELS USED ===`);
Object.entries(intents).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(2)}  ${k}`));

// ── per-persona detail ───────────────────────────────────────────────────────
console.log(`\n=== PER-PERSONA TOP-3  (listing[$pp · intention]) ===`);
for (const p of R) {
  const picks = p.picks.map((x) => `${short(x.title)}[$${x.per_person}·${x.intention.replace(/Best |Most |Closest to /, "")}]`).join("  ");
  const tgt = p.proximity_targets ? ` {${p.proximity_targets.join(",")}}` : "";
  console.log(`  ${p.label.padEnd(30)}${tgt.padEnd(16)} ${picks}`);
}

// ── sensitivity: do single-priority personas get different sets? ─────────────
const sp = R.filter((p) => p.label.startsWith("priority:"));
const sigs = new Set(sp.map((p) => p.picks.map((x) => x.listing_id).sort().join(",")));
console.log(`\n=== PERSONALIZATION SENSITIVITY ===`);
console.log(`  single-priority personas: ${sp.length} | distinct top-3 SETS: ${sigs.size} | distinct #1 picks: ${new Set(sp.map((p) => p.picks[0]?.listing_id)).size}`);
console.log(`  (higher = more personalized; ${sp.length} distinct = every priority yields a different result)`);

if (errs.length) console.log(`\n⚠️  ${errs.length} personas errored:`, errs.map((e) => `${e.label}: ${e.error}`).join(" | "));
console.log("");
