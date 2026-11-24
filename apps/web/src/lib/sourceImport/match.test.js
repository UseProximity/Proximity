import { test } from "node:test";
import assert from "node:assert/strict";
import { nameMatchAliases } from "./match.js";

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
