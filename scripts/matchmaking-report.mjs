#!/usr/bin/env node
/*
 * MATCHMAKING — REALISTIC-STREAM SPREAD, COVERAGE & SEGMENT REPORT
 * ===============================================================
 * The single script to characterize the CURRENT matchmaking algorithm. Run it,
 * read the numbers; change a ranking rule in src/lib/matchmaking/listingFilter.js;
 * run it again and compare. Saturation is part of the algorithm and is always ON
 * here (this mirrors production exactly).
 *
 * The report is built ENTIRELY from one realistic stream of N seeded synthetic
 * students (a market-like mix of priorities / budgets / group sizes / neighbor-
 * hoods). There is no separate "controlled grid" lens — everything below is the
 * realistic stream.
 *
 * OUTPUT
 *   Each run writes a timestamped Markdown report to:
 *       scripts/matchmaking-reports/matchmaking-report-<UTC timestamp>.md
 *   so you keep a history and can diff one algorithm version against another.
 *   (A one-line summary + the file path are printed to the terminal.)
 *
 * WHAT IT REPORTS
 *   0. PROVENANCE       — exactly how the data is retrieved & scored.
 *   1. CORPUS           — the inventory + how much of it carries each data signal.
 *   2. COVERAGE         — what % of priced inventory the stream actually surfaces.
 *   3. SPREAD           — concentration of headlines (distinct / top-share / HHI /
 *                         entropy) + the full headline distribution + timeline.
 *   4. LISTING→USERS    — which listings were shown to which kinds of students.
 *   5. NEIGHBORHOOD     — does a stated neighborhood actually land the headline in
 *                         that neighborhood? (adherence %, overall + per area)
 *   6. SEGMENTS         — how the picks shift as ONE preference dimension changes
 *                         (neighborhood / lead priority / budget band / group size)
 *                         — the realistic-stream answer to "what moves the result?"
 *   7. SAMPLE STUDENTS  — a sample of individual students with prefs + top-3.
 *
 * DATA SOURCE (how retrieval works)
 *   Calls one DEV-ONLY route (403s on a production build):
 *     GET /api/dev/matchmaking-saturation-sim?n=&seed=
 *   It builds N seeded students and runs each through the EXACT production path:
 *     recomputeFromPreferences -> buildRankContext -> selectTopThree (saturation ON)
 *   and returns a corpus summary plus, per student, their preference summary, full
 *   top-3 picks, and whether the headline fell inside their requested neighborhood.
 *   Listings come from Supabase via src/lib/supabase — the DB the dev server points
 *   at (locally: the dev project, per src/lib/appEnv), filtered deleted_at IS NULL
 *   AND unavailable = false, limit 200. Top-3 is deterministic (no LLM); saturation
 *   is fetchSaturation() (live 'contacted' x2 + prior matches x1). Nothing is written.
 *
 * HOW TO RUN
 *   1. Start the dev server (the route 403s in production):
 *        npm run dev
 *   2. In another terminal:
 *        node scripts/matchmaking-report.mjs
 *      Optional args:  node scripts/matchmaking-report.mjs [baseUrl] [n] [seed]
 *        baseUrl  default http://localhost:3000  (must be a NON-prod build)
 *        n        default 150   number of realistic students
 *        seed     default 42    RNG seed (same seed = same stream)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const baseUrl = process.argv[2] || "http://localhost:3000";
const N = process.argv[3] || "150";
const SEED = process.argv[4] || "42";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "matchmaking-reports");

// ── markdown builder ────────────────────────────────────────────────────────
const md = [];
const w = (s = "") => md.push(s);
const pctR = (x) => `${Math.round(x * 100)}%`;
const pctOf = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const bar = (p, width = 22) => "█".repeat(Math.max(0, Math.round((p / 100) * width))).padEnd(width, "·");
const esc = (s) => String(s).replace(/\|/g, "\\|");
const metric = (label, value, means, calc) => {
  w(`- **${label}:** ${value}`);
  w(`  - _means:_ ${means}`);
  w(`  - _calc:_ ${calc}`);
};

function distStats(ids) {
  const counts = {};
  let total = 0;
  for (const id of ids) { if (!id) continue; counts[id] = (counts[id] ?? 0) + 1; total++; }
  const shares = Object.values(counts).map((c) => c / total);
  const hhi = shares.reduce((s, p) => s + p * p, 0);
  const entropy = total ? -shares.reduce((s, p) => s + p * Math.log2(p), 0) : 0;
  const k = Object.keys(counts).length;
  const maxEntropy = k > 1 ? Math.log2(k) : 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return { total, counts, top, distinct: k, hhi, entropy, evenness: maxEntropy ? entropy / maxEntropy : 0 };
}
const segmentBy = (rows, keyFn) => {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
};

// ── fetch the realistic stream ──────────────────────────────────────────────
console.log(`\nFetching realistic-stream matchmaking data from ${baseUrl} …`);
const res = await fetch(`${baseUrl}/api/dev/matchmaking-saturation-sim?n=${N}&seed=${SEED}`);
if (!res.ok) {
  console.error(`\nRequest failed: ${res.status} ${res.statusText}`);
  console.error(await res.text());
  console.error(`\nIs the dev server running on a NON-production build? (the route 403s in prod)\n`);
  process.exit(1);
}
const sim = await res.json();
const { corpus, students, treatment } = sim;
const denom = corpus.priced || corpus.totalActive;
const nStudents = students.length;

// ── derive pick sets ────────────────────────────────────────────────────────
const titleById = {};
const headlinePicks = [], allPicks = [];
const studentsByListing = {}; // listing_id -> [{lead, area, slot}]
for (const s of students) {
  s.picks.forEach((p, idx) => {
    if (!p.listing_id) return;
    titleById[p.listing_id] = p.title || p.listing_id.slice(0, 8);
    allPicks.push(p.listing_id);
    if (idx === 0) headlinePicks.push(p.listing_id);
    (studentsByListing[p.listing_id] ??= []).push({ lead: s.lead, area: s.area[0] || "No preference", slot: idx + 1 });
  });
}
const surfacedTop3 = new Set(allPicks);
const surfacedHead = new Set(headlinePicks);
const head = distStats(headlinePicks);
const areaOf = (s) => (s.area && s.area.length ? s.area[0] : "No preference");
const budgetBand = (b) => b == null ? "no budget" : b <= 1000 ? "≤ $1000" : b <= 1500 ? "$1001–1500" : b <= 2000 ? "$1501–2000" : "> $2000";

// helper: top headlines for a set of students, as a compact string
const topHeadlines = (rows, k = 2) => {
  const st = distStats(rows.map((r) => r.picks[0]?.listing_id));
  if (!st.total) return "—";
  return st.top.slice(0, k).map(([id, c]) => `${titleById[id]} (${pctOf(c, st.total)})`).join(" · ");
};

/* ════════════════════════════════════════════════════════════════════════ */
const ts = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "") + "Z";
w(`# Matchmaking Report — realistic stream`);
w("");
w(`_generated ${sim.generatedAt}_`);
w("");
w(`| | |`);
w(`|---|---|`);
w(`| **Source** | ${baseUrl} (dev DB via \`src/lib/appEnv\`) |`);
w(`| **Stream** | ${sim.params.n} seeded students, seed ${sim.params.seed} |`);
w(`| **Saturation** | ON (production behavior) |`);

/* 0 ── PROVENANCE */
w("");
w(`## 0 · Provenance — how this data is produced`);
w("");
w(`- **Students:** ${sim.params.n} synthetic students generated from seed ${sim.params.seed} — a market-like mix of lead priority, budget, group size, and neighborhood. Same seed ⇒ identical stream, so two runs differ only by your algorithm change.`);
w(`- **Listings:** Supabase \`listings\` (LISTING_SELECT + listing_walk_times), filtered \`deleted_at IS NULL AND unavailable = false\`, limit 200, via \`src/lib/supabase\`.`);
w(`- **Scoring:** each student → \`recomputeFromPreferences\` → \`buildRankContext\` → \`selectTopThree\`. Top-3 is deterministic (no LLM).`);
w(`- **Saturation (ON):** \`fetchSaturation()\` reads live demand — \`user_listing_interactions\` 'contacted' ×2 + prior \`matchmaking_chat_sessions.recommendations\` ×1 — applied as a tie-break among near-equal, in-budget, priority-satisfying listings. Never writes.`);
w(`- **Baseline:** ${sim.baseline.listingsWithSignal} listings currently carry a saturation signal (${sim.baseline.note}).`);

/* 1 ── CORPUS */
w("");
w(`## 1 · Corpus — the inventory the algorithm chooses from`);
w("");
metric("active listings", corpus.totalActive,
  "every bookable listing in the connected DB — the universe the matchmaker can pick from",
  "`listings` where `deleted_at IS NULL AND unavailable = false`");
metric("priced listings", `${corpus.priced} (${pctOf(corpus.priced, corpus.totalActive)} of active) — **coverage denominator**`,
  "listings with an active lease rent, so they can be budget-ranked & surfaced at all",
  "count with ≥ 1 active `unit_lease` where `rent > 0`");
if (corpus.priceQuartiles) {
  const q = corpus.priceQuartiles;
  metric("price/person", `$${q.min} · p25 $${q.p25} · median $${q.median} · p75 $${q.p75} · max $${q.max}`,
    "market width — a wider spread is what lets different budgets receive different picks",
    "min per-person rent per listing, then quartiles across priced listings");
}
w("");
w(`### Data-dimension coverage (how much of the corpus even *has* each signal)`);
w("");
w(`| Dimension | Count | % of active | Why it matters |`);
w(`|---|---|---|---|`);
w(`| with reviews | ${corpus.withReviews} | ${pctOf(corpus.withReviews, corpus.totalActive)} | caps the 'Great reviews' priority |`);
w(`| with amenities | ${corpus.withAnyAmenity} | ${pctOf(corpus.withAnyAmenity, corpus.totalActive)} | feeds 'Amenities' / 'Quiet' |`);
w(`| with campus walk | ${corpus.withCampusWalk} | ${pctOf(corpus.withCampusWalk, corpus.totalActive)} | feeds 'Close to campus' |`);
w(`| with med walk | ${corpus.withMedWalk} | ${pctOf(corpus.withMedWalk, corpus.totalActive)} | feeds med-campus proximity |`);
w(`| with grocery walk | ${corpus.withGroceryWalk} | ${pctOf(corpus.withGroceryWalk, corpus.totalActive)} | feeds grocery proximity |`);

/* 2 ── COVERAGE */
w("");
w(`## 2 · Coverage — how much inventory the stream actually shows`);
w("");
metric("top-3 coverage", `**${pctOf(surfacedTop3.size, denom)}** (${surfacedTop3.size} of ${denom} priced)`,
  "share of priced inventory that appears in SOME student's top-3 across the stream",
  "distinct listing_ids across every student's top-3 ÷ priced");
metric("headline coverage", `${pctOf(surfacedHead.size, denom)} (${surfacedHead.size} of ${denom} priced)`,
  "share that wins the #1 slot for at least one student",
  "distinct #1 picks ÷ priced");
metric("never surfaced", `${denom - surfacedTop3.size} (${pctOf(denom - surfacedTop3.size, denom)})`,
  "priced listings no student in the stream ever sees",
  "priced − distinct top-3 listings");

/* 3 ── SPREAD */
w("");
w(`## 3 · Spread — do different students get different listings, or does one win?`);
w("");
metric("distinct headlines", `${head.distinct} of ${nStudents} students`,
  "how many different listings lead across the stream (higher = more personalized)",
  "unique #1 picks across students");
metric("top headline share", pctR(head.top.length ? head.top[0][1] / head.total : 0),
  "largest fraction of students funneled to one #1 listing (lower = less concentration)",
  "(most common #1 count) ÷ students");
metric("concentration (HHI)", `${head.hhi.toFixed(3)} (1 = one listing wins all · →0 = even)`,
  "how much #1 picks pile onto a few listings",
  "Σ (each listing's share of headlines)²");
metric("entropy / evenness", `${head.entropy.toFixed(2)} bits · ${pctR(head.evenness)} of max`,
  "variety of the headline distribution; evenness normalizes for how many listings appeared",
  "−Σ p·log2(p) · entropy ÷ log2(distinct)");
w("");
w("```");
for (const [id, c] of head.top) {
  w(`${String(pctR(c / head.total)).padStart(4)} ${bar((c / head.total) * 100)}  ${titleById[id]} (${c})`);
}
w(`\ntimeline (busiest-listing share across thirds): ${sim.timeline.treatment.map((s) => `${s.topShare}% (${s.distinct} distinct)`).join("  →  ")}`);
w("```");

/* 4 ── LISTING → USERS */
w("");
w(`## 4 · Which listings were shown to which students`);
w("");
w(`For every surfaced listing: how many students saw it, how often it was the #1, and the kinds of students it served.`);
w("");
w(`| Listing | Shown to | as #1 | Top lead priorities | Top neighborhoods |`);
w(`|---|---|---|---|---|`);
const surfacedSorted = [...surfacedTop3].sort((a, b) => studentsByListing[b].length - studentsByListing[a].length);
for (const id of surfacedSorted) {
  const apps = studentsByListing[id];
  const asHead = apps.filter((a) => a.slot === 1).length;
  const leadTop = [...distStats(apps.map((a) => ({ x: a.lead })).map((o) => o.x)).top].slice(0, 2).map(([k, c]) => `${k} (${c})`).join(", ");
  const hoodTop = [...distStats(apps.map((a) => a.area)).top].slice(0, 2).map(([k, c]) => `${k} (${c})`).join(", ");
  w(`| ${esc(titleById[id])} | ${apps.length} (${pctOf(apps.length, nStudents)}) | ${asHead} | ${esc(leadTop)} | ${esc(hoodTop)} |`);
}

/* 5 ── NEIGHBORHOOD ADHERENCE */
w("");
w(`## 5 · Neighborhood adherence — does a stated area land the headline there?`);
w("");
const hoodStudents = students.filter((s) => s.area && s.area.length);
const adhered = hoodStudents.filter((s) => s.headline_in_hood).length;
metric("students naming a neighborhood", `${hoodStudents.length} of ${nStudents} (${pctOf(hoodStudents.length, nStudents)})`,
  "how much of the stream actually exercises the neighborhood preference",
  "students with a non-'No preference' area");
metric("headline-in-neighborhood rate", hoodStudents.length ? `**${pctOf(adhered, hoodStudents.length)}** (${adhered} of ${hoodStudents.length})` : "—",
  "of students who named a neighborhood, the share whose #1 pick actually sits inside it (the rest had no in-area, in-budget option)",
  "students with `headline_in_hood = true` ÷ students naming a neighborhood");
w("");
w(`| Neighborhood | Students | Headline in-area | Top headline(s) |`);
w(`|---|---|---|---|`);
for (const [area, rows] of segmentBy(hoodStudents, areaOf)) {
  const ad = rows.filter((r) => r.headline_in_hood).length;
  w(`| ${esc(area)} | ${rows.length} | ${pctOf(ad, rows.length)} (${ad}/${rows.length}) | ${esc(topHeadlines(rows))} |`);
}

/* 6 ── SEGMENTS */
w("");
w(`## 6 · Segments — what moves the result?`);
w("");
w(`Each table groups the stream by one preference dimension and shows the top headline(s) per segment. If segments produce different listings, that dimension is steering the algorithm; if they all show the same listing, it isn't.`);

const segTable = (title, keyFn, order) => {
  w("");
  w(`### By ${title}`);
  w("");
  w(`| ${title} | Students | Distinct headlines | Top headline(s) |`);
  w(`|---|---|---|---|`);
  let entries = [...segmentBy(students, keyFn)];
  if (order) entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  else entries.sort((a, b) => b[1].length - a[1].length);
  for (const [k, rows] of entries) {
    const st = distStats(rows.map((r) => r.picks[0]?.listing_id));
    w(`| ${esc(String(k))} | ${rows.length} | ${st.distinct} | ${esc(topHeadlines(rows))} |`);
  }
};
segTable("neighborhood", areaOf);
segTable("lead priority", (s) => s.lead || "—");
segTable("budget band", (s) => budgetBand(s.budget_max), ["≤ $1000", "$1001–1500", "$1501–2000", "> $2000", "no budget"]);
segTable("group size", (s) => s.group_size || "—", ["1", "2", "3", "4", "5"]);

/* 7 ── SAMPLE STUDENTS */
w("");
w(`## 7 · Sample students — raw proof`);
w("");
w(`A sample of individual students: their preferences, then top-3 (title, $per-person, score). ✓/✗ = headline inside the requested neighborhood.`);
w("");
w("```");
for (const s of students.slice(0, 18)) {
  const area = s.area.length ? s.area.join("/") : "no-area";
  const hood = s.headline_in_hood == null ? "" : s.headline_in_hood ? " ✓in-area" : " ✗out-of-area";
  const budget = s.budget_max == null ? "no-budget" : `$${s.budget_max}`;
  w(`lead=${s.lead} | ${budget} | group ${s.group_size} | ${area}${hood}`);
  s.picks.forEach((p, i) => {
    const pp = p.per_person != null ? `$${p.per_person}` : "—";
    const sc = p.score != null ? (p.score.toFixed?.(2) ?? p.score) : "—";
    w(`  ${i + 1}. ${(p.title || "?").padEnd(34)} ${String(pp).padStart(7)}   score ${sc}`);
  });
  w("");
}
w("```");

// ── write the file ──────────────────────────────────────────────────────────
await mkdir(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, `matchmaking-report-${ts}.md`);
await writeFile(outPath, md.join("\n") + "\n", "utf8");

// terminal: quick summary + path
console.log(`\nMatchmaking report written:\n  ${outPath}\n`);
console.log(`  corpus:        ${corpus.totalActive} active / ${corpus.priced} priced`);
console.log(`  coverage:      ${pctOf(surfacedTop3.size, denom)} top-3 · ${pctOf(surfacedHead.size, denom)} headline`);
console.log(`  spread:        ${head.distinct} distinct headlines · top ${pctR(head.top.length ? head.top[0][1] / head.total : 0)} · HHI ${head.hhi.toFixed(3)}`);
console.log(`  neighborhood:  ${hoodStudents.length ? pctOf(adhered, hoodStudents.length) : "—"} of area-namers got an in-area headline (${adhered}/${hoodStudents.length})`);
console.log("");
