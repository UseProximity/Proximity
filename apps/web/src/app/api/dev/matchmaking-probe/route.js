/*
 * Matchmaking bias probe — DEV-ONLY diagnostic (returns 403 in production).
 *
 *   GET /api/dev/matchmaking-probe
 *
 * Runs a fixed sweep of deliberately-divergent personas through the EXACT
 * production ranking path (recomputeFromPreferences -> computeRecommendations ->
 * rankListings) and returns, per persona, the derived weights + top-3 picks,
 * plus a corpus summary (price spread, review/amenity/walk-time coverage). It is
 * the reusable test for "does the matchmaker personalize, or hand everyone the
 * same listing?" — drive it with `node scripts/matchmaking-probe.mjs`, which
 * prints the concentration / universal-favorites / sensitivity report.
 *
 * Personas are designed so a correct ranker returns DIFFERENT listings across
 * them; if one listing wins everything, that's the bias signal.
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { LISTING_SELECT } from "@/lib/listings/listingSelect";
import { recomputeFromPreferences } from "@/lib/matchmaking/questionEngine";
import { computeRecommendations } from "@/lib/matchmaking/chatOrchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// A persona is a COMPLETED preferences object (as if the chat finished).
// recomputeFromPreferences then derives production-identical weights.
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
  commute: ["Walk"],
  priorities: ["Good value", "Close to campus", "Great reviews", "Amenities", "Social/parties", "Close to other WashU students", "Quiet/study"],
  notes: "",
  _extras_done: true,
};

const ALL_PRIORITIES = [
  "Close to campus", "Good value", "Great reviews", "Amenities",
  "Quiet/study", "Social/parties", "Close to other WashU students",
];
const priorityStack = (lead) => [lead, ...ALL_PRIORITIES.filter((p) => p !== lead)];
// Sharp stack: lead first, "Good value" pushed to the BOTTOM (unless it's the
// lead) so the single-priority sweep truly isolates the lead dimension instead of
// every persona also caring strongly about price.
const sharpStack = (lead) =>
  lead === "Good value"
    ? priorityStack(lead)
    : [lead, ...ALL_PRIORITIES.filter((p) => p !== lead && p !== "Good value"), "Good value"];
const persona = (label, overrides) => ({ label, prefs: { ...BASE, ...overrides } });

const PERSONAS = [
  // 1) Single-priority sweep — only the #1 priority changes (value de-emphasized).
  ...ALL_PRIORITIES.map((p) => persona(`priority:${p}`, { priorities: sharpStack(p) })),

  // 2) Budget tiers (balanced priorities) — does price dominate the pick?
  persona("budget:$900", { budget_max: 900 }),
  persona("budget:$1200", { budget_max: 1200 }),
  persona("budget:$1800", { budget_max: 1800 }),
  persona("budget:$3000", { budget_max: 3000 }),
  persona("budget:none", { budget_max: null, _budget_unsure: true }),

  // 3) Group sizes — bedroom-count pressure.
  persona("group:1", { group_size: "1" }),
  persona("group:3", { group_size: "3" }),
  persona("group:5", { group_size: "5" }),

  // 4) Proximity targets — should surface DIFFERENT listings near each place.
  persona("proximity:med-year", { year_of_school: "Med" }),
  persona("proximity:med-explicit", { proximity_targets: ["med_campus"], priorities: sharpStack("Close to campus") }),
  persona("proximity:grocery", { proximity_targets: ["grocery"], priorities: sharpStack("Close to campus") }),
  persona("proximity:campus", { proximity_targets: ["campus"], priorities: sharpStack("Close to campus") }),

  // 5) Area-specific
  persona("area:Loop", { area: ["The Loop"] }),
  persona("area:Clayton", { area: ["Clayton"] }),
  persona("area:CWE", { area: ["Central West End"] }),

  // 6) Mixed realistic personas
  persona("mix:budget-senior-close", { year_of_school: "Senior", budget_max: 1000, group_size: "4", priorities: priorityStack("Good value"), commute: ["Walk", "Bike"] }),
  persona("mix:amenities-social-highbudget", { budget_max: 2500, group_size: "3", furnished: "Yes", priorities: ["Amenities", "Social/parties", "Close to other WashU students", "Great reviews", "Close to campus", "Good value", "Quiet/study"] }),
  persona("mix:quiet-grad-reviews", { year_of_school: "Grad", budget_max: 1600, group_size: "1", priorities: ["Quiet/study", "Great reviews", "Close to campus", "Good value", "Amenities", "Social/parties", "Close to other WashU students"] }),
  persona("mix:biggroup-value", { group_size: "5", budget_max: 1100, priorities: ["Good value", "Close to other WashU students", "Amenities", "Close to campus", "Social/parties", "Great reviews", "Quiet/study"] }),
];

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

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: allListings, error } = await supabase
    .from("listings")
    .select(`${LISTING_SELECT}, listing_walk_times(minutes, locations(name))`)
    .is("deleted_at", null)
    .eq("unavailable", false)
    .limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const corpus = corpusStats(allListings);

  const results = [];
  for (const p of PERSONAS) {
    const { preferences, weights } = recomputeFromPreferences(p.prefs);
    let top3 = [];
    let err = null;
    try {
      top3 = await computeRecommendations(preferences, weights);
    } catch (e) {
      err = String(e?.message ?? e);
    }
    results.push({
      label: p.label,
      proximity_targets: preferences.proximity_targets ?? null,
      budget_max: preferences.budget_max ?? null,
      group_size: preferences.group_size ?? null,
      topWeights: Object.entries(weights).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v.toFixed(2)}`),
      error: err,
      picks: (top3 ?? []).map((r) => ({
        listing_id: r.listing_id,
        title: r.card_data?.title ?? null,
        intention: r.intention,
        score: r.score,
        per_person: r.card_data?.min_rent ?? null,
        reason: r.reason,
      })),
    });
  }

  return NextResponse.json({ generatedAt: new Date().toISOString(), corpus, personaCount: PERSONAS.length, results });
}
