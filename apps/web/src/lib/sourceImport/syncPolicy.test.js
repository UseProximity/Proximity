import { test } from "node:test";
import assert from "node:assert/strict";
import { churnCheck, decideSyncChange, DENY } from "./syncPolicy.js";

const full = { snapshot: { unitListComplete: true } };
const partial = { snapshot: { unitListComplete: false } };
const decide = (c, ctx = full) => decideSyncChange({ detail: {}, ...c }, ctx);

test("additions apply", () => {
  for (const kind of ["photos_added", "unit_updated", "lease_new", "lease_updated"]) {
    assert.equal(decide({ kind }).apply, true, kind);
  }
  assert.deepEqual(decide({ kind: "unit_new", detail: { publish: true } }), { apply: true, reason: null });
  // A unit that conflicts with the listing's format, or is gated, still goes in, as a draft.
  const draft = decide({ kind: "unit_new", detail: { draft: true }, note: "added as a draft: listed as floor plans here" });
  assert.equal(draft.apply, true);
  assert.match(draft.reason, /draft/);
});

test("the landlord's own data wins", () => {
  assert.deepEqual(decide({ kind: "spec_mismatch" }), { apply: false, reason: DENY.specs });
  assert.deepEqual(decide({ kind: "property_updated" }), { apply: false, reason: DENY.property });
  // Anything the landlord set, whatever the kind.
  assert.deepEqual(decide({ kind: "lease_withdrawn", protected: true }), { apply: false, reason: DENY.landlord });
  assert.deepEqual(decide({ kind: "photos_added", protected: true }), { apply: false, reason: DENY.landlord });
  // A lease the landlord took down is not put back by the website.
  assert.deepEqual(decide({ kind: "unit_relisted", auto: false }), { apply: false, reason: DENY.takenDown });
  // One the sync took down comes back.
  assert.equal(decide({ kind: "unit_relisted", auto: true }).apply, true);
});

test("withdrawals need a read of the whole unit list", () => {
  assert.equal(decide({ kind: "lease_withdrawn" }, full).apply, true);
  assert.deepEqual(decide({ kind: "lease_withdrawn" }, partial), { apply: false, reason: DENY.partialRead });
  // A unit's own page speaks for that unit, whatever the rest of the read saw.
  assert.equal(decide({ kind: "lease_withdrawn", detail: { fromUnitPage: true } }, partial).apply, true);
  assert.equal(decide({ kind: "lease_withdrawn", detail: { unitPageGone: true } }, partial).apply, true);
  // No units or no prices read at all: says nothing about what is let.
  assert.deepEqual(decide({ kind: "missing_unit" }), { apply: false, reason: DENY.noLettings });
  // A unit the website never showed (added by hand, another link): left as is.
  assert.deepEqual(decide({ kind: "missing_unit", notFromSite: true }), { apply: false, reason: DENY.notFromSite });
  // Perhaps the same unit renamed: the old one stays up.
  const renamed = decide({ kind: "lease_withdrawn", lookalike: true, note: "may be this unit renamed" });
  assert.equal(renamed.apply, false);
  assert.match(renamed.reason, /renamed/);
});

test("a rent change needs the price itself, not a starting-at", () => {
  assert.equal(decide({ kind: "rent_change", facts: { fromModel: false, rentExact: false } }).apply, true);
  assert.equal(decide({ kind: "rent_change", facts: { fromModel: true, rentExact: true } }).apply, true);
  assert.deepEqual(decide({ kind: "rent_change", facts: { fromModel: true, rentExact: false } }), { apply: false, reason: DENY.roughPrice });
});

test("holds set while planning keep their reason", () => {
  const gated = decide({ kind: "lease_new", gated: true, note: "waiting for the landlord to publish: no agreement" });
  assert.equal(gated.apply, false);
  assert.match(gated.reason, /agreement/);
  const elsewhere = decide({ kind: "unit_new", elsewhere: true, note: "already on Lindell Tower East; held instead of added" });
  assert.equal(elsewhere.apply, false);
  assert.match(elsewhere.reason, /Lindell/);
  // A gated new unit is not denied: it goes in as a draft.
  assert.equal(decide({ kind: "unit_new", gated: true, detail: { draft: true } }).apply, true);
});

test("anything else is not the sync's to make", () => {
  assert.deepEqual(decide({ kind: "listing_gone" }), { apply: false, reason: DENY.unknown });
});

test("the churn guard", () => {
  const apply = { verdict: { apply: true } };
  const leases = (n, kind = "lease_withdrawn") => Array.from({ length: n }, () => ({ kind, ...apply }));
  const unit = (offers = 1, draft = false) => ({ kind: "unit_new", detail: { offers: Array(offers).fill({}), draft }, ...apply });
  // Two of ten leases is a fifth: fine. Three is too many.
  assert.equal(churnCheck({ changes: leases(2), existingLeases: 10, existingUnits: 5 }), null);
  assert.deepEqual(churnCheck({ changes: leases(3), existingLeases: 10, existingUnits: 5 }), { touched: 3, existing: 10, newUnits: 0, units: 5 });
  // Denied changes are no churn.
  assert.equal(churnCheck({ changes: leases(9).map((c) => ({ ...c, verdict: { apply: false } })), existingLeases: 10, existingUnits: 5 }), null);
  // A new unit counts each lease it brings.
  assert.ok(churnCheck({ changes: [unit(3)], existingLeases: 10, existingUnits: 9 }));
  // New units have their own cap, even on a listing too small for the lease rule.
  assert.ok(churnCheck({ changes: [unit(), unit(), unit(), unit(), unit()], existingLeases: 2, existingUnits: 20 }));
  assert.ok(churnCheck({ changes: [unit(), unit()], existingLeases: 1, existingUnits: 1 }));
  assert.equal(churnCheck({ changes: [unit()], existingLeases: 1, existingUnits: 1 }), null);
  // Drafts change nothing students see.
  assert.equal(churnCheck({ changes: Array.from({ length: 12 }, () => unit(0, true)), existingLeases: 12, existingUnits: 12 }), null);
  // A leasing portal's weekly repricing is not churn, but new units still are.
  assert.equal(churnCheck({ changes: leases(40, "rent_change"), existingLeases: 50, existingUnits: 8, portalPriced: true }), null);
  assert.ok(churnCheck({ changes: [unit(), unit(), unit(), unit(), unit()], existingLeases: 50, existingUnits: 8, portalPriced: true }));
});
