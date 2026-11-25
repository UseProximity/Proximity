import { test } from "node:test";
import assert from "node:assert/strict";
import { planChanges, availableNow, namesTheProperty } from "./chatListingRules.js";

const westgate = { title: "841 Westgate Avenue", address: "841 Westgate Avenue, University City, Missouri 63130, United States" };
const lease = (code, over = {}) => ({ id: `id-${code}`, code, rent: 1600, available_from: null, unavailable: false, is_active: true, listing_units: { name: "Whole property" }, ...over });
const BEN = "Hi Kimberly,\n\nWe don't currently have any units available at 841 Westgate.\n\nHowever, we have a LG 1BD at our nearby property at 6246 North Dr.";
const taken = (offering = "ALL") => ({ about: "listing_change", quote: "We don't currently have any units available at 841 Westgate.", changes: [{ offering, field: "unavailable", value: "true" }], reason: "" });

test("Ben's message takes the listing off the market", () => {
  const r = planChanges({ reading: taken(), text: BEN, leases: [lease("O1")], today: "2026-11-24" });
  assert.equal(r.skipped, null);
  assert.deepEqual(r.changes.map((c) => [c.leaseId, c.field, c.from, c.to]), [["id-O1", "unavailable", false, true]]);
});

test("a statement about now never reaches an offering for a later move-in", () => {
  const r = planChanges({ reading: taken(), text: BEN, leases: [lease("O1", { available_from: "2027-08-01" })], today: "2026-11-24" });
  assert.equal(r.changes.length, 0);
  assert.match(r.skipped, /later move-in/);
});

test("a move-in within 60 days counts as now", () => {
  assert.equal(availableNow({ available_from: "2027-01-10" }, "2026-11-24"), true);
  assert.equal(availableNow({ available_from: "2027-08-01" }, "2026-11-24"), false);
  assert.equal(availableNow({ available_from: null }, "2026-11-24"), true);
});

test("a quote that is not in the message changes nothing", () => {
  const r = planChanges({ reading: { ...taken(), quote: "It has been leased." }, text: BEN, leases: [lease("O1")], today: "2026-11-24" });
  assert.equal(r.skipped, "quote not found in the message");
});

test("true for this student only, or no offering named on a multi-offering listing, changes nothing", () => {
  assert.equal(planChanges({ reading: { about: "this_student_only", quote: "", changes: [] }, text: BEN, leases: [lease("O1")] }).skipped, "this_student_only");
  assert.equal(planChanges({ reading: { about: "listing_change", quote: "x", changes: [] }, text: "x is it", leases: [lease("O1"), lease("O2")] }).skipped, "unclear which offering");
});

test("a co-landlord changes only their own leases", () => {
  const r = planChanges({ reading: taken(), text: BEN, leases: [lease("O1"), lease("O2")], ownerLeaseIds: new Set(["id-O2"]), today: "2026-11-24" });
  assert.deepEqual(r.changes.map((c) => c.leaseId), ["id-O2"]);
});

test("already off the market is not a change", () => {
  const r = planChanges({ reading: taken(), text: BEN, leases: [lease("O1", { unavailable: true, is_active: false })], today: "2026-11-24" });
  assert.equal(r.changes.length, 0);
});

test("a message must name the property or the unit", () => {
  assert.equal(namesTheProperty(BEN, { listing: westgate }), true);
  assert.equal(namesTheProperty("Sorry, we're fully leased right now.", { listing: westgate }), false);
  assert.equal(namesTheProperty("The Garden Loft has been leased.", { listing: westgate, unit: "Garden Loft" }), true);
  // "Whole property" and the like are not names.
  assert.equal(namesTheProperty("The whole property is leased.", { listing: westgate, unit: "Whole property" }), false);
  assert.equal(namesTheProperty("The Lindell Tower apartments are all leased.", { listing: { title: "Lindell Tower", address: "1 Main St, St. Louis" } }), true);
});
