import { test } from "node:test";
import assert from "node:assert/strict";
import { nameMatchAliases, naturalName } from "./match.js";

const db = [
  { id: "u1", name: "Pershing", bedrooms: 2, bathrooms: 2, area: 900 },
  { id: "u2", name: "London", bedrooms: 1, bathrooms: 1, area: 600 },
  { id: "u3", name: null, bedrooms: 3, bathrooms: 2, area: 1200 },
];

test("a unit matched by name is pinned to its key", () => {
  const rows = nameMatchAliases([{ key: "n:pershing", name: "Pershing", bedrooms: 2, bathrooms: 2, area: 900 }], db);
  assert.deepEqual(rows.map((r) => [r.source_key, r.unit_id]), [["n:pershing", "u1"]]);
});

test("a layout-only match is a guess and is never pinned", () => {
  const rows = nameMatchAliases([{ key: "l:3-2-1200", name: null, bedrooms: 3, bathrooms: 2, area: 1200 }], db);
  assert.equal(rows.length, 0);
});

test("a key already pinned to that unit is not saved again", () => {
  const rows = nameMatchAliases([{ key: "n:london", name: "London", bedrooms: 1, bathrooms: 1, area: 600 }], db, new Map([["n:london", "u2"]]));
  assert.equal(rows.length, 0);
});

test("a key the read lists twice is ambiguous and never pinned", () => {
  const u = { key: "n:london", name: "London", bedrooms: 1, bathrooms: 1, area: 600 };
  assert.equal(nameMatchAliases([u, { ...u }], db).length, 0);
});

test("a unit read off its own page is pinned to that unit", () => {
  const rows = nameMatchAliases([{ key: "n:apt4", name: "Apt 4", pinnedUnitId: "u3", bedrooms: 3, bathrooms: 2, area: 1200 }], db);
  assert.deepEqual(rows.map((r) => r.unit_id), ["u3"]);
});

test("of two names for one plan, the word wins over the code", () => {
  assert.equal(naturalName("A012", "London"), "London");
  assert.equal(naturalName("Pershing", "B.22"), "Pershing");
  assert.equal(naturalName("Plan 3", "The Musial"), "The Musial");
  assert.equal(naturalName("London", "Paris"), "London");
});

test("a name that is the other plus the address is the same unit", async () => {
  const { nameWithin, matchUnits, genericName } = await import("./match.js");
  const place = "7350 Lindell Blvd, St. Louis, MO 63130";
  assert.equal(nameWithin("302", "7350 Lindell Blvd. -302", place), true);
  assert.equal(nameWithin("307", "7350 Lindell -307", place), true);
  assert.equal(nameWithin("302", "7350 Lindell Blvd. -307", place), false);
  assert.equal(nameWithin("A1", "A1 Renovated", place), false);
  assert.equal(nameWithin("A1", "A10", place), false);
  const units = [{ id: "a", name: "302", bedrooms: 0, bathrooms: 1 }, { id: "b", name: "307", bedrooms: 1, bathrooms: 1 }];
  const { pairs, unmatched } = matchUnits([{ name: "7350 Lindell Blvd. -302", bedrooms: 0, bathrooms: 1 }], units, { place });
  assert.equal(pairs[0].db.id, "a");
  assert.deepEqual(unmatched.map((u) => u.id), ["b"]);
  // With both on the listing, the exact name wins and the short one is left over.
  const both = matchUnits([{ name: "7350 Lindell Blvd. -302", bedrooms: 0, bathrooms: 1 }], [units[0], { id: "c", name: "7350 Lindell Blvd. -302", bedrooms: 0, bathrooms: 1 }], { place });
  assert.equal(both.pairs[0].db.id, "c");
  assert.deepEqual(both.unmatched.map((u) => u.id), ["a"]);
  assert.equal(genericName("1 Bedroom"), true);
  assert.equal(genericName("Studio"), true);
  assert.equal(genericName("Ruby"), false);
});
