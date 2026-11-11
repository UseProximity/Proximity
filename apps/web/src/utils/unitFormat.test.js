// node --test apps/web/src/utils/unitFormat.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { unitFormat, listingUnitFormat, formatConflict } from "./unitFormat.js";

test("apartments", () => {
  for (const n of ["Apt 201", "Apt 1W", "Apt B", "Apt 2s", "Apt. 4", "Apartment 4B", "#3", "#12", "Suite 210", "Ste 210", "No. 12", "Unit 5548", "Unit 201A", "305", "5560B"]) {
    assert.equal(unitFormat(n), "apartment", n);
  }
});

test("floor plans", () => {
  for (const n of ["Studio", "Studio A", "2 Bed 2 Bath", "1 Bedroom Small", "2 Bedroom 1 Bathroom with Balcony", "1BR/1BA – B1 Type A", "FLOOR PLAN B", "2 Bed TH", "The Aspen", "Taylor", "Market Premium", "McPherson II", "CMLH-2Bd", "Nova", "Noble", "Nook", "Stella", "Steel", "Suites", "Aptos"]) {
    assert.equal(unitFormat(n), "plan", n);
  }
});

test("unknown: placeholders and codes that could be either", () => {
  for (const n of [null, "", "Whole property", "Entire house", "Apartment", "Floor 2", "1st flr", "A1", "C1", "Unit A2", "Unit B4", "2Q", "100N107a", "C-12aPH", "Apt -"]) {
    assert.equal(unitFormat(n), null, String(n));
  }
});

test("listing format and conflicts", () => {
  assert.equal(listingUnitFormat(["Whole property"]), null);
  assert.equal(listingUnitFormat(["The Aspen", "Studio", "A1"]), "plan");
  assert.equal(listingUnitFormat(["Apt 1W", "Apt 2E", "Whole property"]), "apartment");
  assert.equal(listingUnitFormat(["Apt 1W", "Studio"]), null);
  // Delmar Estates: a whole-property listing gains numbered apartments.
  assert.equal(formatConflict(listingUnitFormat(["Whole property"]), "Unit 5548"), false);
  assert.equal(formatConflict("plan", "Apt 201"), true);
  assert.equal(formatConflict("apartment", "2 Bed 2 Bath"), true);
  assert.equal(formatConflict("plan", "B2"), false);
  assert.equal(formatConflict("apartment", "Apt 3W"), false);
});
