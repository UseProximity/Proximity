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
// Only three 4-bed listings exist in the dev DB, so a 4-person search is the
// cleanest way to starve the pool on purpose. Auto-pruning two of them leaves a
// single match — exactly the "you got 2 cards" case the backfill exists for.
const AUTO_PRUNED = [
  "3dbd4922-6050-4792-9feb-f4dd66e07292", // 6633 Clemens Ave, 4bd $2400
  "f9c1f49b-8ab6-4d8e-b0ca-ab1832c6fa66", // 725 Interdrive, 4bd $3600
];

const lead = (p) => [p, ...BASE.priorities.filter((x) => x !== p)];
const persona = (label, overrides, flags = {}) => ({ label, prefs: { ...BASE, ...overrides }, ...flags });

const PERSONAS = [
  // Wyatt's exact case: a 6-person group, which only a flush multi-unit combo fits.
  persona("wyatt:6 / $1500 / Loop / amenities", { group_size: "6", area: ["The Loop"], priorities: lead("Amenities") }, { excludeTop: true, capBelowTop: true }),
  // Big group, no budget cap — does the flush split gate it correctly?
  persona("biggroup:6 / no budget", { group_size: "6", budget_max: null, _budget_unsure: true }),
  // Five-person group at a tight budget — likely nothing fits -> honest note.
  persona("group5:$900 tight", { group_size: "5", budget_max: 900, priorities: lead("Good value") }),
  // THE REGRESSION: a trio must never be handed a building of 2-bed units. Every
  // pick here must have a single 3-bedroom unit, and unit_split must be false.
  persona("group3:single-unit only", { group_size: "3", budget_max: 1000, area: ["The Loop"], priorities: lead("Close to campus") }),
  // Four is still below the split threshold — single unit or nothing.
  persona("group4:single-unit only", { group_size: "4", budget_max: 1200 }),
  // Impossible budget below the price floor — should fall back AND flag.
  persona("group3:$400 impossible", { group_size: "3", budget_max: 400 }),
  // Big group leaning value (the flush multi-unit "live together" path).
  persona("group6:value / $1100", { group_size: "6", budget_max: 1100, priorities: lead("Good value") }),
  // Group bigger than any building can flush — the strict bed floor must return
  // NO picks plus the honest group note, never too-small places.
  persona("group50:strict floor -> empty", { group_size: "50", budget_max: null, _budget_unsure: true }),
  // Med student, mid group — proximity targeted at the medical campus.
  persona("med:group4 / med campus", { year_of_school: "Med", group_size: "4", proximity_targets: ["med_campus"], priorities: lead("Close to campus") }),
  // Neighborhood-strict pair in Clayton.
  persona("hood:Clayton pair", { group_size: "2", area: ["Clayton"], priorities: lead("Close to campus") }),
  // Control: solo renter, high budget — behavior should be unchanged, no note.
  persona("solo:$3000 amenities", { group_size: "1", budget_max: 3000, priorities: lead("Amenities") }, { excludeTop: true }),
  // BACKFILL: our own silent auto-pruning starved the field. `_narrowed` holds
  // places the student answered away (must stay gone); `_autoPruned` holds ones
  // we dropped for them (must come BACK rather than leave them 1-2 cards).
  // Expect: 3 picks, and every _autoPruned id allowed to reappear.
  persona("backfill:autoPruned returns", {
    group_size: "4",
    budget_max: 1200,
    priorities: lead("Close to campus"),
    _autoPruned: AUTO_PRUNED,
  }),
  // Same search WITHOUT the auto-prune, as the baseline to compare against.
  persona("backfill:baseline (no prune)", {
    group_size: "4",
    budget_max: 1200,
    priorities: lead("Close to campus"),
  }),
  // THE FLOOR: the student's OWN tradeoff answers cut the field to one listing.
  // Answered-away places are revived only as a last resort, but a one-card result
  // is worse than reviving them — expect 3 picks, not 1.
  persona("floor:narrowed to one", {
    group_size: "4",
    budget_max: 1200,
    priorities: lead("Close to campus"),
    _narrowed: AUTO_PRUNED,
  }),
];

function bedroomsOf(listing) {
  return (listing.listing_units ?? []).flatMap((u) =>
    (u.unit_leases ?? []).filter((l) => l.is_active && l.rent > 0).map(() => Number(u.bedrooms) || 0)
  );
}
const maxBedsOf = (l) => Math.max(0, ...bedroomsOf(l));
// Every rentable unit's bedroom count — the raw material a flush 5+ split is
// built from (e.g. [3,2] can house exactly five). Mirrors unitBedSizes in
// listingFilter: priced units when any exist, otherwise the units' own counts,
// so an unpriced-but-sized listing doesn't print as if it had no bedrooms.
const unitBedsOf = (l) => {
  const units = (l.listing_units ?? []).filter((u) => (Number(u.bedrooms) || 0) > 0);
  const priced = units.filter((u) => (u.unit_leases ?? []).some((x) => x.is_active && x.rent > 0));
  return (priced.length ? priced : units).map((u) => Number(u.bedrooms) || 0).sort((a, b) => b - a);
};

function rankOnce(allListings, prefs, saturation) {
  const { preferences: rebuilt, weights } = recomputeFromPreferences(prefs);
  // recomputeFromPreferences deliberately resets narrowing state (editing an
  // answer invalidates tradeoffs asked about a different pool), so the harness
  // re-attaches the auto-prune set it's specifically exercising.
  const preferences = { ...rebuilt };
  for (const k of ["_autoPruned", "_narrowed"]) {
    if (prefs[k]?.length) preferences[k] = [...prefs[k]];
  }
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
      unit_split: r.unit_split,
      reason: r.reason,
      max_unit_beds: l ? maxBedsOf(l) : null,
      unit_beds: l ? unitBedsOf(l) : null,
      backfilled: !!ctx.backfilledById?.[r.listing_id],
    };
  });
  return { picks, backfilledCount: Object.keys(ctx.backfilledById ?? {}).length, groupNote: ctx.groupNote, budgetNote: ctx.budgetNote, relaxNote: ctx.relaxNote ?? null, poolSize: ctx.pool.length, budgetMax: ctx.budgetMax };
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
