import { test } from "node:test";
import assert from "node:assert/strict";
import { editedFields, trimForLandlord, rentBasisFrom, convertRentBasis, applyAliases, renamedUnitKey, sameValue, syncedLeaseRecord, isSyncBlank } from "./learnRules.js";

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

test("a website name is learned only when the name is all that differs", async () => {
  const { learnableSiteName } = await import("./learnRules.js");
  const base = { kind: "spec_mismatch", unitKey: "n:x", unitId: "u1" };
  assert.equal(learnableSiteName({ ...base, field: "name", old: { name: "2 Bedroom" }, new: { name: "Candy" } }), true);
  // A floor plan against one apartment: a different kind of unit, not a rename.
  assert.equal(learnableSiteName({ ...base, field: "name", old: { name: "Apt 734" }, new: { name: "Moreno" } }), false);
  // Size differs too: a layout match, not a rename.
  assert.equal(learnableSiteName({ ...base, field: "area,name", old: { name: "Holden" }, new: { name: "Horne" } }), false);
  assert.equal(learnableSiteName({ ...base, field: "bedrooms" }), false);
});

test("only a blank the sync created on a call-for-price read is a sync blank", () => {
  const blank = { rent: null };
  // Created by a read that priced nothing on the website: marked.
  const created = syncedLeaseRecord(null, { values: { rent: null, rent_is_per_person: null, lease_term_months: [] }, askForPrice: true });
  assert.equal(created.askForPrice, true);
  assert.equal(isSyncBlank(blank, created), true);
  // A later sync write (new dates) keeps the marker while the lease stays blank.
  const later = syncedLeaseRecord(created, { values: { available_from: "2027-01-01" } }, blank);
  assert.equal(isSyncBlank(blank, later), true);
  // The landlord's own blank lease, relisted by the sync: its blank rent is
  // remembered, but that is not a sync blank (PR 478 review).
  const relisted = syncedLeaseRecord({ rent: null, rent_is_per_person: null }, { values: { unavailable: false, is_active: true } }, blank);
  assert.equal(relisted.rent, null);
  assert.equal(isSyncBlank(blank, relisted), false);
  // No memory at all: the landlord's.
  assert.equal(isSyncBlank(blank, undefined), false);
});

test("a sync blank stops being one once it has a rent", () => {
  const created = syncedLeaseRecord(null, { values: { rent: null }, askForPrice: true });
  // The website priced it and the sync wrote the price.
  const priced = syncedLeaseRecord(created, { values: { rent: 1200 } }, { rent: null });
  assert.equal("askForPrice" in priced, false);
  // The landlord priced it, then the sync wrote something else.
  const landlordPriced = syncedLeaseRecord(created, { values: { available_from: "2027-01-01" } }, { rent: 1300 });
  assert.equal("askForPrice" in landlordPriced, false);
  assert.equal(isSyncBlank({ rent: null }, landlordPriced), false);
  // A lease with a rent now is never a sync blank, marker or not.
  assert.equal(isSyncBlank({ rent: 1200 }, created), false);
});
