#!/usr/bin/env node
/*
 * Saturation simulation runner. Start the dev server (`npm run dev`), then:
 *   node scripts/matchmaking-saturation-sim.mjs [baseUrl] [n] [seed]
 *
 * Hits /api/dev/matchmaking-saturation-sim and prints a CONTROL (saturation off)
 * vs TREATMENT (saturation on) comparison: how much the same student stream
 * concentrates on a few listings, and how the busiest listing's share decays
 * across the run as matches/contacts accrue.
 */
const baseUrl = process.argv[2] || "http://localhost:3000";
const n = process.argv[3] || "120";
const seed = process.argv[4] || "42";

const bar = (pct, width = 24) => "█".repeat(Math.round((pct / 100) * width)).padEnd(width, "·");

function printPass(name, s) {
  console.log(`\n=== ${name} ===`);
  console.log(`  distinct headline listings: ${s.distinct}   top listing share: ${Math.round(s.topShare * 100)}%   HHI: ${s.hhi}  (1=monopoly)   entropy: ${s.entropy}`);
  console.log(`  most-matched listings:`);
  for (const r of s.top10) {
    console.log(`    ${String(r.share + "%").padStart(4)} ${bar(r.share)}  ${r.title}`);
  }
}

const res = await fetch(`${baseUrl}/api/dev/matchmaking-saturation-sim?n=${n}&seed=${seed}`);
if (!res.ok) {
  console.error(`Request failed: ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}
const data = await res.json();

console.log(`\nSATURATION SIMULATION — ${data.params.n} students, seed ${data.params.seed}`);
console.log(`Live DB saturation baseline: ${data.baseline.listingsWithSignal} listings carry a signal (${data.baseline.note})`);

printPass("CONTROL  (saturation OFF — today's behavior)", data.control);
printPass("TREATMENT (saturation ON — spread demand)", data.treatment);

console.log(`\n=== TIMELINE — busiest-listing share across the run (thirds) ===`);
const fmt = (t) => t.map((x) => `${String(x.topShare + "%").padStart(4)} (${x.distinct} distinct)`).join("   →   ");
console.log(`  control:   ${fmt(data.timeline.control)}`);
console.log(`  treatment: ${fmt(data.timeline.treatment)}`);

const c = data.control, t = data.treatment;
console.log(`\n=== SUMMARY ===`);
console.log(`  distinct headlines:  ${c.distinct}  →  ${t.distinct}   (+${t.distinct - c.distinct})`);
console.log(`  top listing share:   ${Math.round(c.topShare * 100)}%  →  ${Math.round(t.topShare * 100)}%`);
console.log(`  concentration (HHI): ${c.hhi}  →  ${t.hhi}   (lower = more spread)`);
console.log("");
