import { test } from "node:test";
import assert from "node:assert/strict";
import { editedFields, trimForLandlord, rentBasisFrom, convertRentBasis, applyAliases, renamedUnitKey, sameValue } from "./learnRules.js";

const synced = { rent: 1200, rent_is_per_person: false, lease_term_months: [12], available_from: null, description: "Apt 2B" };

test("values compare the way the database stores them", () => {
  assert.equal(sameValue([12, 9], [9, 12]), true);
  assert.equal(sameValue("1200", 1200), true);
  assert.equal(sameValue(null, undefined), true);
  assert.equal(sameValue(null, "2026-12-01"), false);
});

test("a field the landlord changed after the sync wrote it", () => {
  assert.deepEqual([...editedFields({ ...synced }, synced)], []);
  assert.deepEqual([...editedFields({ ...synced, lease_term_months: [9, 12] }, synced)], ["lease_term_months"]);
  // Nothing remembered: nothing to call an edit.
  assert.deepEqual([...editedFields({ ...synced, rent: 1 }, null)], []);
});

test("the landlord's edit stays while the website says what it said", () => {
  const db = { ...synced, lease_term_months: [9, 12] };
  // The website still says 12 months, the value the sync wrote: the landlord's 9 and 12 stay.
  assert.deepEqual(trimForLandlord({ lease_term_months: [12], description: "Apt 2B, 2C" }, db, synced), {
    patch: { description: "Apt 2B, 2C" },
    dropped: ["lease_term_months"],
  });
  // The website now says 14 months: a real change, it goes through.
  assert.deepEqual(trimForLandlord({ lease_term_months: [14] }, db, synced), { patch: { lease_term_months: [14] }, dropped: [] });
  // A field the landlord never touched is the sync's to change.
  assert.deepEqual(trimForLandlord({ available_from: "2027-01-01" }, db, synced), { patch: { available_from: "2027-01-01" }, dropped: [] });
});

test("a rent and its basis go together", () => {
  const db = { ...synced, rent: 400, rent_is_per_person: true };
  const r = trimForLandlord({ rent: 1200, rent_is_per_person: false }, db, synced);
  assert.deepEqual(r.patch, {});
  assert.deepEqual(r.dropped.sort(), ["rent", "rent_is_per_person"]);
});

test("a landlord who split the rent per person", () => {
  assert.equal(rentBasisFrom({ rent: 900, rent_is_per_person: true }, { rent: 2700, rent_is_per_person: false }, 3), "per_person");
  assert.equal(rentBasisFrom({ rent: 905, rent_is_per_person: true }, { rent: 2700, rent_is_per_person: false }, 3), "per_person");
  // A different price, not a split.
  assert.equal(rentBasisFrom({ rent: 1100, rent_is_per_person: true }, { rent: 2700, rent_is_per_person: false }, 3), null);
  // A one-bedroom's rent is the same either way.
  assert.equal(rentBasisFrom({ rent: 900, rent_is_per_person: true }, { rent: 900, rent_is_per_person: false }, 1), null);
});

test("the website's rents, as this landlord states them", () => {
  const units = [
    { bedrooms: 3, offers: [{ rent: 2700, rentIsPerPerson: false }, { rent: 800, rentIsPerPerson: true }, { rent: null }] },
    { bedrooms: 1, offers: [{ rent: 1100, rentIsPerPerson: false }] },
  ];
  convertRentBasis(units, "per_person");
  assert.equal(units[0].offers[0].rent, 900);
  assert.equal(units[0].offers[0].rentIsPerPerson, true);
  assert.equal(units[0].offers[1].rent, 800);
  assert.equal(units[1].offers[0].rent, 1100);
  assert.equal(units[1].offers[0].rentIsPerPerson, false);
});

test("a website name pinned to the landlord's unit", () => {
  const units = [{ key: "n:candy" }, { key: "n:ocean" }, { key: "n:unit5", pinnedUnitId: "u9" }];
  applyAliases(units, new Map([["n:candy", "u1"], ["n:ocean", "gone"], ["n:unit5", "u2"]]), new Set(["u1", "u2", "u9"]));
  assert.equal(units[0].pinnedUnitId, "u1");
  // The landlord removed that unit: not pinned.
  assert.equal(units[1].pinnedUnitId, undefined);
  // Already pinned by its own page.
  assert.equal(units[2].pinnedUnitId, "u9");
});

test("a unit the landlord renamed", () => {
  assert.equal(renamedUnitKey({ name: "2 Bedroom" }, { name: "Candy", siteKey: "n:candy" }), "n:candy");
  assert.equal(renamedUnitKey({ name: "Candy" }, { name: "Candy", siteKey: "n:candy" }), null);
  assert.equal(renamedUnitKey({ name: "2 Bedroom" }, { name: "Candy" }), null);
});
