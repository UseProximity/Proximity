/*
 * Run with: npm test (from apps/web).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  leaseFit,
  partitionLeases,
  moveInOptions,
  leaseMonthOptions,
  moveInHasPassed,
  normalizeMoveIn,
  normalizeMonths,
  missReason,
  normalizeBeds,
  normalizeBedsList,
  normalizeMonthsList,
  listingOfferings,
  listingChoices,
  listingPrefs,
  closestOffered,
  listingMatches,
  unitMoveInOptions,
  sortPlans,
  sortLandlords,
} from "./leaseFit.js";

const TODAY = "2026-10-27";
const lease = (id, rent, availableFrom, leaseTermMonths) => ({ id, rent, availableFrom, leaseTermMonths });

test("normalizers accept only real months and lengths", () => {
  assert.equal(normalizeMoveIn("2026-11-17"), "2026-11-01");
  assert.equal(normalizeMoveIn("2026-11"), "2026-11-01");
  assert.equal(normalizeMoveIn("2026-13-01"), null);
  assert.equal(normalizeMoveIn("soon"), null);
  assert.equal(normalizeMonths("12"), 12);
  assert.equal(normalizeMonths(0), null);
  assert.equal(normalizeMonths(61), null);
  assert.equal(normalizeMonths(2.5), null);
});

test("a lease starting inside the move-in month fits", () => {
  const f = leaseFit(lease(1, 1000, "2026-11-30", [12]), { moveIn: "2026-11-01", months: 12 }, TODAY);
  assert.equal(f.kind, "exact");
});

test("a lease starting after the move-in month misses on date", () => {
  const f = leaseFit(lease(1, 1000, "2026-12-01", [12]), { moveIn: "2026-11-01", months: 12 }, TODAY);
  assert.equal(f.date, "miss");
  assert.equal(f.kind, "miss");
  assert.equal(f.dateDays, 1);
});

test("a start date in the past reads as now and fits any future month", () => {
  const f = leaseFit(lease(1, 1000, "2026-04-01", [12]), { moveIn: "2027-08-01" }, TODAY);
  assert.equal(f.date, "fit");
});

test("unstated date or term is unknown, not a miss", () => {
  const f = leaseFit(lease(1, 1000, null, []), { moveIn: "2026-11-01", months: 12 }, TODAY);
  assert.equal(f.date, "unknown");
  assert.equal(f.term, "unknown");
  assert.equal(f.kind, "unknown");
});

test("a term array fits when it contains the chosen length", () => {
  assert.equal(leaseFit(lease(1, 1, null, [10, 12]), { months: 10 }, TODAY).term, "fit");
  const miss = leaseFit(lease(1, 1, null, [9, 13]), { months: 12 }, TODAY);
  assert.equal(miss.term, "miss");
  assert.equal(miss.termGap, 1);
});

test("a move-in month that has passed is treated as this month", () => {
  assert.equal(moveInHasPassed("2026-08-01", TODAY), true);
  assert.equal(moveInHasPassed("2026-10-01", TODAY), false);
  const f = leaseFit(lease(1, 1, "2026-10-30", [12]), { moveIn: "2026-08-01" }, TODAY);
  assert.equal(f.date, "fit");
  const late = leaseFit(lease(1, 1, "2026-11-02", [12]), { moveIn: "2026-08-01" }, TODAY);
  assert.equal(late.date, "miss");
});

test("no preferences keeps everything, cheapest first, nothing collapsed", () => {
  const p = partitionLeases([lease("a", 2000, null, [12]), lease("b", 1500, null, [12]), lease("c", null, null, [])], {}, TODAY);
  assert.equal(p.active, false);
  assert.deepEqual(p.fits.map((l) => l.id), ["b", "a", "c"]);
  assert.equal(p.misses.length, 0);
  assert.equal(p.note, null);
});

test("exact fits lead, unknowns follow, misses are split off closest first", () => {
  const leases = [
    lease("unknown", 900, null, [12]),
    lease("exact-dear", 2100, "2026-11-01", [12]),
    lease("exact-cheap", 2000, "2026-11-05", [12]),
    lease("miss-far", 1500, "2026-11-01", [15]),
    lease("miss-near", 1600, "2026-11-01", [13]),
  ];
  const p = partitionLeases(leases, { moveIn: "2026-11-01", months: 12 }, TODAY);
  assert.deepEqual(p.fits.map((l) => l.id), ["exact-cheap", "exact-dear", "unknown"]);
  assert.deepEqual(p.misses.map((l) => l.id), ["miss-near", "miss-far"]);
  assert.equal(p.note, null);
});

test("when nothing fits, the note says why", () => {
  const p = partitionLeases([lease("a", 1, "2026-11-01", [10]), lease("b", 1, "2026-11-01", [13])], { months: 12 }, TODAY);
  assert.equal(p.fits.length, 0);
  assert.match(p.note, /No 12-month lease on this unit/);

  const late = partitionLeases([lease("a", 1, "2027-02-01", [12])], { moveIn: "2026-11-01" }, TODAY);
  assert.match(late.note, /earliest start here is Feb 1, 2027/);
});

test("a single lease that misses still shows, with its reason", () => {
  const only = lease("only", 1000, "2027-02-01", [12]);
  const p = partitionLeases([only], { moveIn: "2026-11-01", months: 12 }, TODAY);
  assert.equal(p.misses.length, 1);
  assert.ok(p.note);
  assert.equal(missReason(only, { moveIn: "2026-11-01", months: 12 }, TODAY), "Starts Feb 1, 2027, after your move-in");
});

test("pickers offer 24 months ahead and keep a passed or long saved value", () => {
  const opts = moveInOptions(TODAY);
  assert.equal(opts.length, 24);
  assert.equal(opts[0].value, "2026-10-01");
  assert.equal(opts[0].label, "Oct 2026");
  assert.equal(opts[23].value, "2028-09-01");
  const withPassed = moveInOptions(TODAY, "2026-08-01");
  assert.equal(withPassed[0].label, "Aug 2026 (passed)");
  assert.equal(leaseMonthOptions().length, 24);
  assert.equal(leaseMonthOptions(36).at(-1).value, 36);
});

test("a unit's pickers offer only the months and lengths it has", async () => {
  const { unitMoveInOptions, unitLeaseMonthOptions, prefsForUnit } = await import("./leaseFit.js");
  const leases = [
    lease("a", 1, "2026-04-01", [12]),
    lease("b", 1, "2026-12-05", [10, 12]),
    lease("c", 1, "2026-12-20", [15]),
    lease("d", 1, null, []),
  ];
  assert.deepEqual(unitMoveInOptions(leases, TODAY).map((o) => o.label), ["Now", "Dec 2026"]);
  assert.deepEqual(unitLeaseMonthOptions(leases).map((o) => o.value), [10, 12, 15]);
  // A saved value this unit lacks is left unselected; one it has is kept.
  assert.deepEqual(prefsForUnit({ moveIn: "2027-08-01", months: 12 }, leases, TODAY), { moveIn: null, months: [12] });
  assert.deepEqual(prefsForUnit({ moveIn: "2026-12-01", months: 24 }, leases, TODAY), { moveIn: "2026-12-01", months: [] });
});

// A listing: two 2 bed plans and a studio (Wyatt, 2026-10-30).
const UNITS = [
  { id: "studio", bedrooms: 0, leases: [lease("s1", 900, "2026-12-01", [12])] },
  { id: "jade", bedrooms: 2, leases: [lease("j1", 1600, "2026-11-01", [12]), lease("j2", 1500, "2027-08-01", [10])] },
  { id: "onyx", bedrooms: 2, leases: [lease("o1", 1700, null, [12])] },
  { id: "empty", bedrooms: 3, leases: [] },
];
const OFFERS = listingOfferings(UNITS);
const vals = (opts) => opts.map((o) => o.value);

test("beds normalizer takes studios and rejects junk", () => {
  assert.equal(normalizeBeds(0), 0);
  assert.equal(normalizeBeds("2"), 2);
  assert.equal(normalizeBeds(-1), null);
  assert.equal(normalizeBeds(1.5), null);
  assert.equal(normalizeBeds(""), null);
});

test("each dropdown offers only what exists given the other two", () => {
  const all = listingChoices(OFFERS, {}, TODAY);
  assert.deepEqual(vals(all.beds), [0, 2]); // the 3 bed has no lease
  assert.deepEqual(vals(all.months), [10, 12]);
  const tenMonths = listingChoices(OFFERS, { months: 10 }, TODAY);
  assert.deepEqual(vals(tenMonths.beds), [2]);
  assert.deepEqual(vals(tenMonths.moveIn), ["2027-08-01"]);
  const studio = listingChoices(OFFERS, { beds: 0 }, TODAY);
  assert.deepEqual(vals(studio.months), [12]);
});

test("saved picks fill in, or their closest alternative, in order beds, length, move-in", () => {
  // No 10 month studio: beds stays, length fills in the studio's closest, 12.
  assert.deepEqual(listingPrefs(OFFERS, { beds: 0, months: 10 }, TODAY), { beds: [0], moveIn: null, months: [12] });
  // No 3 bed lease here: the closest size, 2, fills in and 10 months still applies.
  assert.deepEqual(listingPrefs(OFFERS, { beds: 3, months: 10 }, TODAY), { beds: [2], moveIn: null, months: [10] });
  // A passed move-in month means as soon as possible: the soonest start here.
  assert.deepEqual(listingPrefs(OFFERS, { beds: 2, moveIn: "2026-01-01" }, TODAY), { beds: [2], moveIn: "2026-11-01", months: [] });
  assert.deepEqual(listingPrefs(OFFERS, { beds: 2, moveIn: "2026-11-01" }, TODAY), { beds: [2], moveIn: "2026-11-01", months: [] });
});

test("matches are grouped by floor plan, unknown dates kept after exact ones", () => {
  const m = listingMatches(OFFERS, { beds: 2, months: 12, moveIn: "2026-11-01" }, TODAY);
  assert.deepEqual(m.map((g) => g.unit.id), ["jade", "onyx"]);
  assert.deepEqual(m[0].leases.map((l) => l.id), ["j1"]);
  assert.deepEqual(m[1].leases.map((l) => l.id), ["o1"]);
  assert.equal(listingMatches(OFFERS, {}, TODAY).length, 3);
});

test("a lease already started reads Now in the starting choices", () => {
  const started = { id: "a", rent: 1, availableFrom: "2026-09-01", leaseTermMonths: [12] };
  const later = { id: "b", rent: 1, availableFrom: "2026-12-01", leaseTermMonths: [12] };
  const opts = unitMoveInOptions([started, later], "2026-10-31");
  assert.deepEqual(opts.map((o) => o.label), ["Now", "Dec 2026"]);
  // Later this month is not "Now" yet.
  assert.equal(unitMoveInOptions([{ availableFrom: "2026-10-31" }], "2026-10-20")[0].label, "Oct 2026");
});

test("sortPlans orders by price and by size, nulls last", () => {
  const A = { unit: { name: "A", area: 800 }, leases: [{ rent: 2000 }, { rent: 1500 }] };
  const B = { unit: { name: "B", area: null }, leases: [{ rent: 1200 }] };
  const C = { unit: { name: "C", area: 1000 }, leases: [{ rent: null }] };
  const names = (ps) => ps.map((p) => p.unit.name).join("");
  assert.equal(names(sortPlans([A, B, C], "price-asc")), "BAC");
  assert.deepEqual(sortPlans([A], "price-asc")[0].leases.map((l) => l.rent), [1500, 2000]);
  assert.equal(names(sortPlans([A, B, C], "price-desc")), "ABC");
  assert.equal(names(sortPlans([A, B, C], "area-desc")), "CAB");
  assert.equal(names(sortPlans([A, B, C], "area-asc")), "ACB");
  assert.equal(names(sortPlans([A, B, C], "match")), "ABC");
});

test("price sorts rank on whole-apartment rent, not the stated price", () => {
  // $900/person in a 4 bed is $3,600 for the apartment; the 2 bed is $1,600.
  const four = { unit: { name: "F", area: null }, leases: [{ rent: 900, unitRent: 3600 }] };
  const two = { unit: { name: "T", area: null }, leases: [{ rent: 1600, unitRent: 1600 }] };
  assert.deepEqual(sortPlans([four, two], "price-asc").map((p) => p.unit.name), ["T", "F"]);
  // Without unitRent (older data) the stated rent is used.
  const old = { unit: { name: "O", area: null }, leases: [{ rent: 1000 }] };
  assert.deepEqual(sortPlans([two, old], "price-asc").map((p) => p.unit.name), ["O", "T"]);
});

test("landlords follow the sort: best plan first, then all of theirs", () => {
  const plan = (name, area, rent) => ({ unit: { name, area }, leases: [{ rent }] });
  // A has 1200 and 500 sq ft, B has 900.
  const A = { key: "A", plans: [plan("A1", 500, 900), plan("A2", 1200, 2000)] };
  const B = { key: "B", plans: [plan("B1", 900, 800)] };
  const order = (gs) => gs.map((g) => `${g.key}:${g.plans.map((p) => p.unit.name).join(",")}`).join(" ");
  assert.equal(order(sortLandlords([A, B], "area-desc")), "A:A2,A1 B:B1");
  assert.equal(order(sortLandlords([A, B], "area-asc")), "A:A1,A2 B:B1");
  // Cheapest lease is B's $800, so B leads, then A cheapest first.
  assert.equal(order(sortLandlords([A, B], "price-asc")), "B:B1 A:A1,A2");
  assert.equal(order(sortLandlords([A, B], "price-desc")), "A:A2,A1 B:B1");
  assert.equal(sortLandlords([A, B], "match")[0].key, "A");
});

test("a saved move-in month with no start in it shows the latest start before it", () => {
  // Sep 2027 fits the Aug 2027 lease, so the dropdown reads Aug 2027, not Any.
  assert.deepEqual(listingPrefs(OFFERS, { beds: 2, moveIn: "2027-09-01" }, TODAY), { beds: [2], moveIn: "2027-08-01", months: [] });
  // Earlier than every start: the soonest start after it is the closest alternative.
  assert.equal(listingPrefs(OFFERS, { beds: 0, moveIn: "2026-11-01" }, TODAY).moveIn, "2026-12-01");
});

test("a unit with no bedroom count is not a studio and stays under any size", () => {
  const offers = listingOfferings([...UNITS, { id: "unknown", bedrooms: null, leases: [lease("u1", 1000, null, [12])] }]);
  assert.deepEqual(vals(listingChoices(offers, {}, TODAY).beds), [0, 2]);
  assert.ok(listingMatches(offers, { beds: 2 }, TODAY).some((g) => g.unit.id === "unknown"));
  assert.ok(listingMatches(offers, { beds: 0 }, TODAY).some((g) => g.unit.id === "unknown"));
});

test("several sizes and lengths can be picked at once (Wyatt, 2026-11-01)", () => {
  // Lists, single saved values and junk all read as a clean sorted list.
  assert.deepEqual(normalizeBedsList([2, "0", 2, -1]), [0, 2]);
  assert.deepEqual(normalizeBedsList(3), [3]);
  assert.deepEqual(normalizeBedsList(null), []);
  assert.deepEqual(normalizeMonthsList([12, 9, 0]), [9, 12]);

  // Within a field it is "or": a studio or a 2 bed.
  const both = listingMatches(OFFERS, { beds: [0, 2] }, TODAY);
  assert.deepEqual(both.map((g) => g.unit.id), ["studio", "jade", "onyx"]);
  // Across fields it is "and": 10 or 12 months, but only 2 beds.
  const twoBed = listingMatches(OFFERS, { beds: [2], months: [10, 12] }, TODAY);
  assert.deepEqual(twoBed.flatMap((g) => g.leases.map((l) => l.id)).sort(), ["j1", "j2", "o1"]);
  // A 10 month pick narrows to the one 10 month lease.
  assert.deepEqual(listingMatches(OFFERS, { months: [10] }, TODAY).flatMap((g) => g.leases.map((l) => l.id)), ["j2"]);

  // A picker's options ignore its own picks: picking the studio still offers the 2 bed.
  assert.deepEqual(vals(listingChoices(OFFERS, { beds: [0] }, TODAY).beds), [0, 2]);
  // But they follow the other field: with 10 months picked only the 2 bed is offered.
  assert.deepEqual(vals(listingChoices(OFFERS, { months: [10] }, TODAY).beds), [2]);

  // Saved values the listing lacks become their closest alternative: 3 bed to 2, 24 months to 12.
  assert.deepEqual(listingPrefs(OFFERS, { beds: [2, 3], months: [10, 24] }, TODAY), { beds: [2], moveIn: null, months: [10, 12] });

  // A lease written for any picked length fits; the miss reason names them all.
  assert.equal(leaseFit(lease(1, 1, null, [9]), { months: [9, 12] }, TODAY).term, "fit");
  assert.equal(missReason(lease(1, 1, null, [10]), { months: [6, 9, 12] }, TODAY), "No 6, 9 or 12-month option");
});

test("the closest alternative breaks ties toward the smaller value", () => {
  const opts = (...v) => v.map((value) => ({ value }));
  assert.deepEqual(closestOffered(opts(1, 3), [2]), [1]);
  assert.deepEqual(closestOffered(opts(11, 13), [12]), [11]);
  assert.deepEqual(closestOffered(opts(1, 3), [2, 3]), [1, 3]);
  assert.deepEqual(closestOffered(opts(0, 4), [2, 3]), [0, 4]);
  assert.deepEqual(closestOffered([], [2]), []);
  assert.deepEqual(closestOffered(opts(1, 2), []), []);
});
