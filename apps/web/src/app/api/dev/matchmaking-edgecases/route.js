/*
 * Matchmaking EDGE-CASE probe — DEV-ONLY diagnostic (returns 403 in production).
 *
 *   GET /api/dev/matchmaking-edgecases
 *
 * Exercises the DETERMINISTIC ranking core (buildRankContext -> selectTopThree)
 * directly — no LLM — so it's fast and stable, and isolates the recent group-fit
 * work: "6+" group parsing, multi-unit building capacity, the honest group note,
 * the persistent exclude-set, and the "not as expensive as <listing>" follow-up.
 *
 * Each persona reports its deterministic top-3 plus diagnostics. Personas flagged
 * `excludeTop` re-run after rejecting their own #1 (proving it never resurfaces);
 * `capBelowTop` re-runs with budget set just below the priciest shown listing
 * (the "cheaper than LOCAL" path). Drive it with:
 *   node scripts/matchmaking-edgecases.mjs
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { LISTING_SELECT } from "@/lib/listings/listingSelect";
import { recomputeFromPreferences } from "@/lib/matchmaking/questionEngine";
import {
  buildRankContext,
  selectTopThree,
  fetchSaturation,
} from "@/lib/matchmaking/listingFilter";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
const lead = (p) => [p, ...BASE.priorities.filter((x) => x !== p)];
const persona = (label, overrides, flags = {}) => ({ label, prefs: { ...BASE, ...overrides }, ...flags });

const PERSONAS = [
  // Wyatt's exact case: a 6+ group that "6+" used to collapse to 1.
  persona("wyatt:6+ / $1500 / Loop / amenities", { group_size: "6+", area: ["The Loop"], priorities: lead("Amenities") }, { excludeTop: true, capBelowTop: true }),
  // Big group, no budget cap — does capacity (single + multi-unit) gate it?
  persona("biggroup:6+ / no budget", { group_size: "6+", budget_max: null, _budget_unsure: true }),
  // Five-person group at a tight budget — likely nothing fits -> honest note.
  persona("group5:$900 tight", { group_size: "5", budget_max: 900, priorities: lead("Good value") }),
  // Impossible budget below the price floor — should fall back AND flag.
  persona("group3:$400 impossible", { group_size: "3", budget_max: 400 }),
  // Big group leaning value (the multi-unit "live together" path).
  persona("group6:value / $1100", { group_size: "6+", budget_max: 1100, priorities: lead("Good value") }),
  // Group bigger than any building's collective beds — the strict bed floor
  // must return NO picks plus the honest group note, never too-small places.
  persona("group50:strict floor -> empty", { group_size: "50", budget_max: null, _budget_unsure: true }),
  // Med student, mid group — proximity targeted at the medical campus.
  persona("med:group4 / med campus", { year_of_school: "Med", group_size: "4", proximity_targets: ["med_campus"], priorities: lead("Close to campus") }),
  // Neighborhood-strict pair in Clayton.
  persona("hood:Clayton pair", { group_size: "2", area: ["Clayton"], priorities: lead("Close to campus") }),
  // Control: solo renter, high budget — behavior should be unchanged, no note.
  persona("solo:$3000 amenities", { group_size: "1", budget_max: 3000, priorities: lead("Amenities") }, { excludeTop: true }),
];

function bedroomsOf(listing) {
  return (listing.listing_units ?? []).flatMap((u) =>
    (u.unit_leases ?? []).filter((l) => l.is_active && l.rent > 0).map(() => Number(u.bedrooms) || 0)
  );
}
const maxBedsOf = (l) => Math.max(0, ...bedroomsOf(l));
const capacityOf = (l) =>
  Math.max(
    maxBedsOf(l),
    (l.listing_units ?? []).reduce((s, u) => {
      const active = (u.unit_leases ?? []).some((x) => x.is_active && x.rent > 0);
      return active ? s + (Number(u.bedrooms) || 0) : s;
    }, 0)
  );

function rankOnce(allListings, prefs, saturation) {
  const { preferences, weights } = recomputeFromPreferences(prefs);
  const ctx = buildRankContext(allListings, preferences, weights, 3);
  const top3 = ctx.pool.length
    ? selectTopThree({ ...ctx, preferences, saturation })
    : [];
  const byId = Object.fromEntries(allListings.map((l) => [l.id, l]));
  const picks = top3.map((r) => {
    const l = byId[r.listing_id];
    return {
      title: r.card_data?.title,
      per_person: r.card_data?.min_rent,
      intention: r.intention,
      group_fit: r.group_fit,
      unit_split: r.unit_split,
      reason: r.reason,
      max_unit_beds: l ? maxBedsOf(l) : null,
      building_capacity: l ? capacityOf(l) : null,
    };
  });
  return { picks, groupNote: ctx.groupNote, poolSize: ctx.pool.length, budgetMax: ctx.budgetMax };
}

export async function GET() {
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
  }

  const { data: allListings, error } = await supabase
    .from("listings")
    .select(`${LISTING_SELECT}, listing_walk_times(minutes, locations(name))`)
    .is("deleted_at", null)
    .eq("unavailable", false)
    .limit(80);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const saturation = await fetchSaturation();

  const results = [];
  for (const p of PERSONAS) {
    const parsedGroup = parseInt(String(p.prefs.group_size ?? "").replace(/\+/g, ""), 10) || 1;
    const first = rankOnce(allListings, p.prefs, saturation);
    const entry = {
      label: p.label,
      parsed_group_size: parsedGroup,
      budget_max: p.prefs.budget_max ?? null,
      ...first,
      followups: [],
    };

    // Reject the #1 pick — it must not come back next turn.
    if (p.excludeTop && first.picks[0]) {
      const rejectedId = (() => {
        const { preferences, weights } = recomputeFromPreferences(p.prefs);
        const ctx = buildRankContext(allListings, preferences, weights, 3);
        return selectTopThree({ ...ctx, preferences, saturation })[0]?.listing_id;
      })();
      const after = rankOnce(allListings, { ...p.prefs, _excluded: [rejectedId] }, saturation);
      entry.followups.push({
        kind: "exclude #1",
        rejected_was: first.picks[0].title,
        still_present: after.picks.some((x) => x.title === first.picks[0].title),
        picks: after.picks,
      });
    }

    // "not as expensive as <priciest shown>": cap budget just below it + exclude.
    if (p.capBelowTop && first.picks.length) {
      const priciest = first.picks.reduce((a, b) => (b.per_person > a.per_person ? b : a));
      const cap = Math.max(0, Math.round(priciest.per_person) - 1);
      const rejectedId = (() => {
        const { preferences, weights } = recomputeFromPreferences(p.prefs);
        const ctx = buildRankContext(allListings, preferences, weights, 3);
        return selectTopThree({ ...ctx, preferences, saturation }).find((r) => r.card_data?.title === priciest.title)?.listing_id;
      })();
      const after = rankOnce(allListings, { ...p.prefs, budget_max: cap, _excluded: [rejectedId] }, saturation);
      entry.followups.push({
        kind: `cheaper than "${priciest.title}" ($${priciest.per_person} -> cap $${cap})`,
        still_present: after.picks.some((x) => x.title === priciest.title),
        max_per_person_after: Math.max(0, ...after.picks.map((x) => x.per_person || 0)),
        picks: after.picks,
      });
    }

    results.push(entry);
  }

  return NextResponse.json({ corpus: { fetched: allListings.length }, results });
}
