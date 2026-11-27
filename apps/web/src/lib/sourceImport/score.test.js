import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, landlordFreshness, claimScore, TRUST, startingAtTerm, websiteFreshness } from "./score.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} vs ${b}`);

test("a landlord rent edit fades slowly, then faster (PRD example)", () => {
  near(claimScore({ trust: TRUST.landlord, freshness: landlordFreshness(1, "rent") }), 0.95);
  near(claimScore({ trust: TRUST.landlord, freshness: landlordFreshness(45, "rent") }), 0.47);
  assert.equal(landlordFreshness(64, "rent"), 0);
});

test("a website value that has not moved since the landlord's edit never wins", () => {
  const fresh = websiteFreshness({ landlordEdited: true, movedSinceLandlord: false });
  const d = decide({ action: "update", field: "rent", claim: { trust: TRUST.feed, freshness: fresh } }, { by: "landlord", daysSinceEdit: 400 });
  assert.equal(d.apply, false);
});

test("a website value that moved beats an old landlord edit", () => {
  const d = decide({ action: "update", field: "rent", claim: { trust: TRUST.feed } }, { by: "landlord", daysSinceEdit: 60 });
  assert.equal(d.apply, true);
});

test("a recent landlord edit holds against a moved website value", () => {
  const d = decide({ action: "update", field: "rent", claim: { trust: TRUST.feed } }, { by: "landlord", daysSinceEdit: 2 });
  assert.equal(d.apply, false);
});

test("a landlord-chosen blank rent never fades; the price goes hidden", () => {
  const d = decide({ action: "update", field: "rent", claim: { trust: TRUST.feed } }, { by: "landlord", daysSinceEdit: 900, blankByChoice: true });
  assert.equal(d.apply, false);
  assert.equal(d.hidden, true);
});

test("a guess fills an empty field but never replaces a value", () => {
  assert.equal(decide({ action: "fill", field: "leaseTermMonths", inferred: true, claim: { trust: TRUST.recipe } }, { empty: true }).apply, true);
  assert.equal(decide({ action: "update", field: "leaseTermMonths", inferred: true, claim: { trust: TRUST.recipe } }, { by: "sync", score: 0.4 }).apply, false);
});

test("a starting-at price never replaces an exact one, but fills an empty rent", () => {
  const rough = { action: "update", field: "rent", rentType: "starting_at", claim: { trust: TRUST.feed } };
  assert.equal(decide(rough, { by: "sync", score: 0.5, rentType: "exact" }).apply, false);
  assert.equal(decide({ ...rough, action: "fill" }, { empty: true }).apply, true);
});

test("a withdrawal takes two reads in a row", () => {
  const w = { action: "withdraw", field: "unavailable", claim: { trust: TRUST.feed } };
  assert.equal(decide({ ...w, readsInRow: 1 }, { by: "sync", score: 0.5 }).apply, false);
  assert.equal(decide({ ...w, readsInRow: 2 }, { by: "sync", score: 0.5 }).apply, true);
});

test("a change close to what it needed is borderline, either way", () => {
  const d = decide({ action: "update", field: "rent", claim: { trust: TRUST.feed, readQuality: 0.85 } }, { by: "sync", score: 0.6 });
  assert.equal(d.borderline, true);
});

test("a starting-at price with no per-length prices lands on the 12 month lease", () => {
  assert.equal(startingAtTerm([]), 12);
  assert.equal(startingAtTerm([6, 12]), 12);
  assert.equal(startingAtTerm([9, 10]), 10);
});
