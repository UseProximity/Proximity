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
