/*
 * Matchmaking REALISTIC-STREAM simulation — DEV-ONLY (returns 403 in production).
 *
 *   GET /api/dev/matchmaking-saturation-sim?n=150&seed=42
 *
 * Streams N synthetic students (a seeded, realistic mix of priorities / budgets /
 * group sizes / neighborhoods) through the EXACT production deterministic top-3
 * path (buildRankContext -> selectTopThree). The TREATMENT pass has saturation ON
 * (production behavior) and is what the report consumes; a CONTROL pass (saturation
 * OFF) is kept for reference. No LLM and no DB writes — pure and repeatable.
 *
 * Returns:
 *   • corpus      — totals + per-dimension coverage of the inventory.
 *   • control     — saturation-OFF headline distribution (reference only).
 *   • treatment   — saturation-ON headline distribution (the live algorithm).
 *   • students    — per-student record from the treatment pass: prefs summary +
 *                   full top-3 picks + whether the headline landed in the
 *                   requested neighborhood. This is what the report is built from.
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { LISTING_SELECT } from "@/lib/listings/listingSelect";
import { recomputeFromPreferences } from "@/lib/matchmaking/questionEngine";
import { buildRankContext, selectTopThree, fetchSaturation, neighborhoodScore } from "@/lib/matchmaking/listingFilter";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = {
  name: "Test",
  _name_confirmed: true,
  year_of_school: "Junior",
  group_size: "2",
  budget_max: 1500,
  area: ["No preference"],
  lease_term: "Full year only",
  move_in_month: "August — start of the year",
  furnished: "No preference",
  priorities: ["Good value", "Close to campus", "Great reviews", "Amenities", "Social/parties", "Close to other WashU students", "Quiet/study"],
  notes: "",
  _extras_done: true,
};

const ALL_PRIORITIES = [
  "Close to campus", "Good value", "Great reviews", "Amenities",
  "Quiet/study", "Social/parties", "Close to other WashU students",
];

// Deterministic RNG so the same seed reproduces the same student stream.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// A realistic-ish traffic mix: leads skew toward value / close-to-campus (the
// common cases), budgets span the market, most groups are 1–4, and ~half name a
// neighborhood (weighted toward "No preference", the realistic default).
function makeStream(n, seed) {
  const rng = mulberry32(seed);
  const leadBag = [
    "Good value", "Good value", "Good value", "Close to campus", "Close to campus",
    "Great reviews", "Amenities", "Quiet/study", "Social/parties", "Close to other WashU students",
  ];
  const budgets = [900, 1100, 1100, 1300, 1500, 1500, 1800, 2200, 2800, null];
  const groups = ["1", "2", "2", "3", "4"];
  const areaBag = [
    "No preference", "No preference", "No preference", "No preference", "No preference",
    "The Loop", "The Loop", "Central West End", "Clayton", "DeMun", "DeBaliviere",
  ];
  const users = [];
  for (let i = 0; i < n; i++) {
    const lead = pick(rng, leadBag);
    const rest = ALL_PRIORITIES.filter((p) => p !== lead);
    for (let j = rest.length - 1; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1));
      [rest[j], rest[k]] = [rest[k], rest[j]];
    }
    const budget = pick(rng, budgets);
    const area = pick(rng, areaBag);
    users.push({
      ...BASE,
      priorities: [lead, ...rest],
      budget_max: budget,
      _budget_unsure: budget == null,
      group_size: pick(rng, groups),
      area: [area],
    });
  }
  return users;
}

const mergeCounts = (a, b) => {
  const o = { ...a };
  for (const k in b) o[k] = (o[k] ?? 0) + b[k];
  return o;
};

// Distribution stats for a list of headline listing_ids.
function distStats(headlineByUser) {
  const counts = {};
  let total = 0;
  for (const id of headlineByUser) {
    if (!id) continue;
    counts[id] = (counts[id] ?? 0) + 1;
    total++;
  }
  const shares = Object.values(counts).map((c) => c / total);
  const hhi = shares.reduce((s, p) => s + p * p, 0); // 1 = monopoly, ~0 = even
  const entropy = -shares.reduce((s, p) => s + p * Math.log2(p), 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return {
    total,
    distinct: Object.keys(counts).length,
    topShare: top.length ? top[0][1] / total : 0,
    hhi: Math.round(hhi * 1000) / 1000,
    entropy: Math.round(entropy * 100) / 100,
    top10: top.slice(0, 10),
  };
}

// Corpus summary: totals + how much of the inventory carries each data signal.
function corpusStats(listings) {
  const activeLeasesOf = (l) =>
    (l.listing_units ?? []).flatMap((u) =>
      (u.unit_leases ?? []).filter((x) => x.is_active && x.rent > 0).map((x) => ({ rent: Number(x.rent) }))
    );
  const AMEN = ["air_conditioning","dishwasher","gym","laundry","mailroom","microwave","oven","parking","pets_allowed","pool","refrigerator","rooftop","storage","stove","study_room"];
  const cat = (l) => {
    const out = { campus: 0, med: 0, grocery: 0 };
    for (const w of l.listing_walk_times ?? []) {
      const n = w.locations?.name ?? "";
      if (!Number.isFinite(w.minutes)) continue;
      if (n === "shuttle_nearest") continue;
      else if (/grocery|schnucks/i.test(n)) out.grocery++;
      else if (/^med\s*campus/i.test(n)) out.med++;
      else out.campus++;
    }
    return out;
  };
  const rows = (listings ?? []).map((l) => {
    const leases = activeLeasesOf(l);
    const pp = leases.length ? Math.min(...leases.map((x) => x.rent)) : null;
    const reviews = (l.listing_reviews ?? []).filter((r) => !r.deleted_at && Number.isFinite(r.rating));
    const a = Array.isArray(l.listing_amenities) ? l.listing_amenities[0] : l.listing_amenities;
    const amenCount = a ? AMEN.filter((k) => a[k] === true).length : 0;
    const c = cat(l);
    return { perPerson: pp == null ? null : Math.round(pp), hasReview: reviews.length > 0, amenCount, c };
  });
  const priced = rows.filter((r) => r.perPerson != null).sort((a, b) => a.perPerson - b.perPerson);
  const q = (f) => (priced.length ? priced[Math.floor(priced.length * f)].perPerson : null);
  return {
    totalActive: rows.length,
    priced: priced.length,
    withReviews: rows.filter((r) => r.hasReview).length,
    withAnyAmenity: rows.filter((r) => r.amenCount > 0).length,
    withCampusWalk: rows.filter((r) => r.c.campus > 0).length,
    withMedWalk: rows.filter((r) => r.c.med > 0).length,
    withGroceryWalk: rows.filter((r) => r.c.grocery > 0).length,
    priceQuartiles: priced.length ? { min: priced[0].perPerson, p25: q(0.25), median: q(0.5), p75: q(0.75), max: priced[priced.length - 1].perPerson } : null,
  };
}

export async function GET(req) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const n = Math.min(500, Math.max(20, Number(url.searchParams.get("n")) || 150));
  const seed = Number(url.searchParams.get("seed")) || 42;

  const { data: listings, error } = await supabase
    .from("listings")
    .select(`${LISTING_SELECT}, listing_walk_times(minutes, locations(name))`)
    .is("deleted_at", null)
    .eq("unavailable", false)
    .limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const corpus = corpusStats(listings);
  const listingById = new Map(listings.map((l) => [l.id, l]));
  const titleOf = (id) => {
    const l = listingById.get(id);
    if (!l) return id?.slice(0, 8);
    const t = (l.title ?? "").trim();
    return t || (l.address ?? "").split(",")[0].trim() || id.slice(0, 8);
  };

  // Live saturation baseline: real `contacted` events + any prior matches.
  const baseline = await fetchSaturation();
  const baselineListings = Object.keys(baseline).length;

  const stream = makeStream(n, seed);

  // Pre-derive each student's production preferences/weights once (shared by both
  // passes so the only difference is whether saturation is applied).
  const derived = stream.map((u) => recomputeFromPreferences(u));

  function runPass(withSaturation) {
    const exposure = {};
    const headlineByUser = [];
    const students = [];
    for (const { preferences, weights } of derived) {
      const areas = Array.isArray(preferences.area) ? preferences.area.filter((a) => a && a !== "No preference") : [];
      const ctx = buildRankContext(listings, preferences, weights, 10);
      if (!ctx.pool.length) {
        headlineByUser.push(null);
        if (withSaturation) students.push({ lead: preferences.priorities?.[0] ?? null, budget_max: preferences.budget_max ?? null, group_size: preferences.group_size ?? null, area: areas, picks: [], headline_in_hood: null });
        continue;
      }
      const saturation = withSaturation ? mergeCounts(baseline, exposure) : {};
      const top3 = selectTopThree({ ...ctx, preferences, saturation });
      const head = top3[0]?.listing_id ?? null;
      headlineByUser.push(head);
      if (withSaturation) {
        const headListing = head ? listingById.get(head) : null;
        students.push({
          lead: preferences.priorities?.[0] ?? null,
          budget_max: preferences.budget_max ?? null,
          group_size: preferences.group_size ?? null,
          area: areas,
          picks: top3.map((r) => ({ listing_id: r.listing_id, title: r.card_data?.title ?? titleOf(r.listing_id), per_person: r.card_data?.min_rent ?? null, score: r.score })),
          headline_in_hood: areas.length && headListing ? (neighborhoodScore(headListing, areas) ?? 0) > 0 : null,
        });
      }
      // Accrue exposure from everything shown — headline counts double.
      top3.forEach((r, idx) => {
        exposure[r.listing_id] = (exposure[r.listing_id] ?? 0) + (idx === 0 ? 2 : 1);
      });
    }
    return { headlineByUser, students };
  }

  const control = runPass(false).headlineByUser;
  const treat = runPass(true);
  const treatment = treat.headlineByUser;

  // Timeline: how the busiest listing's share falls across the run (thirds).
  const third = Math.floor(n / 3) || 1;
  const slice = (arr, a, b) => distStats(arr.slice(a, b));
  const timeline = {
    control: [slice(control, 0, third), slice(control, third, 2 * third), slice(control, 2 * third, n)],
    treatment: [slice(treatment, 0, third), slice(treatment, third, 2 * third), slice(treatment, 2 * third, n)],
  };

  const label = (stats) => ({
    ...stats,
    top10: stats.top10.map(([id, c]) => ({ listing_id: id, title: titleOf(id), count: c, share: Math.round((c / stats.total) * 100) })),
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    params: { n, seed },
    baseline: { listingsWithSignal: baselineListings, note: "weighted: contact=2, prior match=1, from live DB" },
    corpus,
    control: label(distStats(control)),
    treatment: label(distStats(treatment)),
    students: treat.students,
    timeline: {
      control: timeline.control.map((s) => ({ distinct: s.distinct, topShare: Math.round(s.topShare * 100), hhi: s.hhi })),
      treatment: timeline.treatment.map((s) => ({ distinct: s.distinct, topShare: Math.round(s.topShare * 100), hhi: s.hhi })),
    },
  });
}
