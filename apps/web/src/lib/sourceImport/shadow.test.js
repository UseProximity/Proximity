import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowRows, actionOf, changeKey } from "./shadow.js";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const state = {
  listing_units: [
    { id: "u1", name: "Pershing", bedrooms: 2, bathrooms: 2, area: 900, unit_leases: [{ id: "l1", rent: 1500 }, { id: "l2", rent: null }] },
  ],
};
const snapshot = { trace: { reader: "rentcafe-embedded" }, units: [{ key: "n:pershing", name: "Pershing", bedrooms: 2, bathrooms: 2, area: 900, offers: [{ rent: 1450, rentExact: true, dateStated: true }] }] };
const rent = (extra = {}) => ({ kind: "rent_change", unitKey: "n:pershing", unitId: "u1", leaseId: "l1", field: "rent", old: { rent: 1500 }, new: { rent: 1450 }, facts: { rentExact: true }, verdict: { apply: true }, ...extra });
const learnings = { synced: new Map([["lease:l1", { rent: 1500 }]]) };

test("an exact rent move from a structured reader applies, like today", () => {
  const [r] = shadowRows({ changes: [rent()], snapshot, state, learnings, now: NOW });
  assert.equal(r.platform, "rentcafe-embedded");
  assert.equal(r.ledger_apply, true);
  assert.equal(r.policy_apply, true);
});

test("a starting-at rent is capped and does not apply over an exact one", () => {
  const [r] = shadowRows({ changes: [rent({ facts: { rentExact: false } })], snapshot, state, learnings, now: NOW });
  assert.equal(r.read_quality, 0.5);
  assert.equal(r.ledger_apply, false);
});

test("a landlord edit with the website unchanged since stays", () => {
  const edits = new Map([["l1", "2026-01-01T00:00:00Z"]]);
  const c = rent({ new: { rent: 1500 } }); // the website still says what the sync wrote
  const [r] = shadowRows({ changes: [c], snapshot, state, learnings, landlordEdits: edits, now: NOW });
  assert.equal(r.landlord_edited, true);
  assert.equal(r.ledger_apply, false);
});

test("a landlord-chosen blank rent goes hidden", () => {
  const edits = new Map([["l2", "2026-01-01T00:00:00Z"]]);
  const c = rent({ leaseId: "l2", old: { rent: 1200 }, new: { rent: 1450 } });
  const [r] = shadowRows({ changes: [c], snapshot, state, learnings, landlordEdits: edits, now: NOW });
  assert.equal(r.ledger_hidden, true);
});

test("a withdrawal needs the second read in a row", () => {
  const w = { kind: "lease_withdrawn", unitKey: "n:pershing", unitId: "u1", leaseId: "l1", field: "unavailable", old: null, new: { unavailable: true }, verdict: { apply: true } };
  const full = { ...snapshot, unitListComplete: true };
  const [first] = shadowRows({ changes: [w], snapshot: full, state, learnings, now: NOW });
  assert.equal(first.ledger_apply, false);
  const [partial] = shadowRows({ changes: [w], snapshot, state, learnings, priorRuns: new Map([[changeKey(w), 1]]), now: NOW });
  assert.equal(partial.ledger_apply, false); // the read did not see the whole list
  const [second] = shadowRows({ changes: [w], snapshot: full, state, learnings, priorRuns: new Map([[changeKey(w), 1]]), now: NOW });
  assert.equal(second.ledger_apply, true);
});

test("a held run records today's rules as not applied", () => {
  const [r] = shadowRows({ changes: [rent()], snapshot, state, learnings, holdReason: "churn_hold", now: NOW });
  assert.equal(r.policy_apply, false);
});

test("filling an empty field is a fill, not an update", () => {
  assert.equal(actionOf({ kind: "lease_updated", field: "availableFrom", old: { availableFrom: null }, new: { availableFrom: "2027-08-01" } }), "fill");
});

test("a lease the landlord took down stays down while the website keeps showing it", () => {
  const c = { kind: "unit_relisted", auto: false, unitKey: "n:pershing", unitId: "u1", leaseId: "l1", field: "unavailable", old: true, new: false, verdict: { apply: false } };
  const [r] = shadowRows({ changes: [c], snapshot, state, learnings, now: NOW });
  assert.equal(r.landlord_edited, true);
  assert.equal(r.ledger_apply, false);
});

test("specs on a unit the landlord made stay the landlord's", () => {
  const c = { kind: "spec_mismatch", unitKey: "n:pershing", unitId: "u1", field: "area", old: { area: 900 }, new: { area: 950 }, verdict: { apply: false } };
  const [r] = shadowRows({ changes: [c], snapshot, state, learnings, now: NOW });
  assert.equal(r.ledger_apply, false);
});

test("a read whose units jump by more than half adds nothing (another building)", () => {
  const units = ["a", "b", "c"].map((n) => ({ kind: "unit_new", unitKey: `n:${n}`, field: "unit", old: null, new: { name: n }, verdict: { apply: true } }));
  const rows = shadowRows({ changes: units, snapshot, state, learnings, now: NOW });
  assert.ok(rows.every((r) => !r.ledger_apply));
});

test("descriptions and specials wait for the weekly read", () => {
  const [r] = shadowRows({ changes: [{ kind: "property_updated", field: "description", old: null, new: { description: "x" }, verdict: { apply: false } }], snapshot, state, learnings, now: NOW });
  assert.equal(r.ledger_apply, false);
});

test("a lease with no synced record (from before 11/11) is not the landlord's", () => {
  const c = { kind: "rent_change", unitKey: "n:pershing", unitId: "u1", leaseId: "l1", field: "rent", old: { rent: 1500 }, new: { rent: 1450 }, facts: { rentExact: true }, verdict: { apply: true } };
  const [r] = shadowRows({ changes: [c], snapshot: { ...snapshot, trace: { reader: "g5" } }, state, learnings: { synced: new Map() }, now: NOW });
  assert.equal(r.landlord_edited, false);
  assert.equal(r.ledger_apply, true);
});

test("the listing gate stands whatever the score", () => {
  const c = { kind: "lease_new", gated: true, note: "waiting for the landlord to publish", unitKey: "n:pershing", unitId: "u1", field: "lease", old: null, new: { rent: 1400 }, verdict: { apply: false } };
  const [r] = shadowRows({ changes: [c], snapshot: { ...snapshot, trace: { reader: "g5" } }, state, learnings, now: NOW });
  assert.equal(r.ledger_apply, false);
  assert.equal(r.ledger_reason, "waiting for the landlord to publish");
});
