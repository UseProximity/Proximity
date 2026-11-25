import { test } from "node:test";
import assert from "node:assert/strict";
import { planChanges, availableNow, namesTheProperty, rentInLeaseTerms } from "./chatListingRules.js";

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

const threeBed = (over = {}) => lease("O1", { rent: 1500, listing_units: { name: "Unit 2", bedrooms: 3 }, ...over });
const rentSays = (value, quote = "Rent at 841 Westgate is now $600.") => ({ about: "listing_change", quote, changes: [{ offering: "O1", field: "rent", value: String(value) }], reason: "" });

test("a rent is read in the lease's own terms, by the saved rent", () => {
  // $1,500 for a 3 bed, "$600": a bed's rent, so $1,800 for the unit.
  assert.deepEqual(rentInLeaseTerms(600, threeBed()), { value: 1800, note: "$600 per bedroom x 3" });
  assert.equal(rentInLeaseTerms(1600, threeBed()).value, 1600);
  // Saved per person: "$4,500" for the unit is $1,500 a person.
  assert.equal(rentInLeaseTerms(4500, threeBed({ rent: 1400, rent_is_per_person: true })).value, 1500);
  // Nowhere near the saved rent either way, or nothing saved on a multi-bed unit: not trusted.
  assert.equal(rentInLeaseTerms(9000, threeBed()), null);
  assert.equal(rentInLeaseTerms(600, threeBed({ rent: null })), null);
  // A 1 bed has one reading.
  assert.equal(rentInLeaseTerms(1450, lease("O1")).value, 1450);
  const r = planChanges({ reading: rentSays(600), text: "Rent at 841 Westgate is now $600.", leases: [threeBed()], today: "2026-11-24" });
  assert.deepEqual(r.changes.map((c) => [c.from, c.to, c.said]), [[1500, 1800, 600]]);
});

test("an em dash in the message does not hide the quote", () => {
  const text = "841 Westgate is fully leased \u2014 sorry!";
  const r = planChanges({ reading: { ...taken(), quote: "841 Westgate is fully leased, sorry!" }, text, leases: [lease("O1")], today: "2026-11-24" });
  assert.equal(r.skipped, null);
});

test("a move-in date in the past changes nothing", () => {
  const r = planChanges({ reading: { about: "listing_change", quote: "not until August 1", changes: [{ offering: "O1", field: "available_from", value: "2026-08-01" }] }, text: "841 Westgate is not until August 1", leases: [lease("O1")], today: "2026-11-24" });
  assert.equal(r.skipped, "a move-in date in the past");
});

test("an offering code not on the list is unclear, and a stray space is ignored", () => {
  assert.equal(planChanges({ reading: { ...taken("O9") }, text: BEN, leases: [lease("O1")], today: "2026-11-24" }).skipped, "unclear which offering");
  assert.equal(planChanges({ reading: { ...taken("O1 ") }, text: BEN, leases: [lease("O1")], today: "2026-11-24" }).changes.length, 1);
});

test("each change says whether it came from a whole-property statement", () => {
  const r = planChanges({ reading: taken(), text: BEN, leases: [lease("O1")], today: "2026-11-24" });
  assert.equal(r.changes[0].all, true);
  assert.equal(planChanges({ reading: taken("O1"), text: BEN, leases: [lease("O1")], today: "2026-11-24" }).changes[0].all, false);
});
