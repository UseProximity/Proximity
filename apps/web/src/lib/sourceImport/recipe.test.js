import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlock, induceRecipe, replayRecipe, compareReads, recipeBroken } from "./recipe.js";

const TODAY = new Date("2026-11-24T12:00:00Z");
// Real page text shapes from the 2026-11-24 preview runs.
const UNION = [
  "IvaS1\nStudio\n/ 1 Bath\n—\n516 sq. ft\nFrom\n$1,185 per month\n12mo lease\n$500\ndeposit\nView Details\n3 Units Available\nSpecials\nUp to 3 Months Free on Select Lease Terms!",
  "IvaS10\nStudio\n/ 1 Bath\n—\n460 sq. ft\n$1,165 per month\n12mo lease\n$500\ndeposit\nView Details\nOnly 1 Unit Available!",
  "IvaS4\nStudio\n/ 1 Bath\n—\n470 sq. ft\nView Details\nWaitlist Available",
  "BookerA5\nStudio\n/ 1 Bath\n—\n754 sq. ft\n$1,510 per month\n12mo lease\n$500\ndeposit\nView Details\nAvailable Dec 23, 2026",
  "IvaB1\n2 Bed\n/ 2 Bath\n—\n1,046 sq. ft\n$1,970 per month\n12mo lease\n$500\ndeposit\nView Details\nOnly 1 Unit Available!",
].join("\n");
const page = (text) => [{ url: "https://x.test/floorplans/", text: `Floor Plans\nFilters\n${text}\nContact Us` }];

test("a block: exact price, deposit ignored, lease length, date", () => {
  const b = parseBlock("BookerA5\nStudio\n/ 1 Bath\n—\n754 sq. ft\n$1,510 per month\n12mo lease\n$500\ndeposit\nView Details\nAvailable Dec 23, 2026", TODAY);
  assert.deepEqual([b.bedrooms, b.bathrooms, b.area], [0, 1, 754]);
  assert.equal(b.offers.length, 1);
  assert.deepEqual([b.offers[0].rent, b.offers[0].rentIsExact, b.offers[0].leaseTermMonths, b.offers[0].availableFrom], [1510, true, [12], "2026-12-23"]);
});

test("a block: From and Starting at are not exact; ranges take the low end", () => {
  assert.equal(parseBlock("Studio\nFrom\n$1,185 per month").offers[0].rentIsExact, false);
  assert.equal(parseBlock("1 Bedroom · 1 Bath · 1,207 sq ft · Starting at $2,751/month · Available now").offers[0].rentIsExact, false);
  const r = parseBlock("Studio+ 1+ ba $1,435 - $2,705 Fees may apply");
  assert.deepEqual(r.offers.map((o) => [o.rent, o.rentIsExact]), [[1435, false]]);
});

test("a block: a waitlisted plan with no price is unavailable; Zillow's line reads whole", () => {
  assert.equal(parseBlock("IvaS4\nStudio\n/ 1 Bath\n470 sq. ft\nView Details\nWaitlist Available").available, false);
  const z = parseBlock("1 bed, 1 bath · 630 sqft Unit 5560 Status: Available now $995", TODAY);
  assert.deepEqual([z.bedrooms, z.bathrooms, z.area, z.offers[0].rent, z.offers[0].rentIsExact, z.offers[0].availableNow], [1, 1, 630, 995, true, true]);
});

test("a recipe made from one read replays it, and IvaS1 is not IvaS10", () => {
  const truth = [
    { name: "IvaS1", bedrooms: 0, offers: [{ rent: 1185 }] },
    { name: "IvaS10", bedrooms: 0, offers: [{ rent: 1165 }] },
    { name: "IvaS4", bedrooms: 0, offers: [] },
    { name: "BookerA5", bedrooms: 0, offers: [{ rent: 1510 }] },
    { name: "IvaB1", bedrooms: 2, offers: [{ rent: 1970 }] },
  ];
  const recipe = induceRecipe({ pages: page(UNION), units: truth });
  assert.equal(recipe.kind, "named");
  assert.deepEqual(recipe.after, ["studio"]);
  const replay = replayRecipe(recipe, page(UNION), { today: TODAY });
  const check = compareReads(replay.units, truth);
  assert.equal(check.ok, true, check.diffs.join("; "));
  assert.equal(replay.units.find((u) => u.name === "IvaS10").offers[0].rentIsExact, true);
  assert.equal(replay.units.find((u) => u.name === "IvaS1").offers[0].rentIsExact, false);
});

test("a unit the site adds later is found by the shape of the line after its name", () => {
  const truth = [{ name: "IvaS1", offers: [{ rent: 1185 }] }, { name: "IvaS10", offers: [{ rent: 1165 }] }, { name: "IvaS4", offers: [] }, { name: "BookerA5", offers: [{ rent: 1510 }] }];
  const recipe = induceRecipe({ pages: page(UNION), units: truth });
  const later = UNION + "\nKnoxS2\nStudio\n/ 1 Bath\n—\n500 sq. ft\n$1,100 per month\n12mo lease";
  const replay = replayRecipe(recipe, page(later), { today: TODAY });
  assert.deepEqual(replay.added, ["KnoxS2"]);
  assert.equal(replay.units.find((u) => u.name === "KnoxS2").offers[0].rent, 1100);
});

test("a recipe whose units are gone from the page is broken", () => {
  const truth = [{ name: "IvaS1", offers: [{ rent: 1185 }] }, { name: "IvaS10", offers: [{ rent: 1165 }] }];
  const recipe = induceRecipe({ pages: page(UNION), units: truth });
  const replay = replayRecipe(recipe, [{ url: "https://x.test/floorplans/", text: "We have moved. Visit our new website." }]);
  assert.equal(recipeBroken(recipe, replay), true);
});

test("plans listed by size alone get a layout recipe", () => {
  const icon = "4 Beds | 2 Baths\nPrivate Bedroom | 1,251 Sq. Ft.\nUnit #\nBase Rent\nUnit 111-D\n$725\n12 Months\nView All 17 Available Units\n4 Beds | 2 Baths\nPrivate Bedroom | 1,275 Sq. Ft.\nUnit 261-A\n$725\n12 Months";
  const recipe = induceRecipe({ pages: page(icon), units: [{ name: null, bedrooms: 4, bathrooms: 2, area: 1251, offers: [{ rent: 725 }] }] });
  assert.equal(recipe.kind, "layout");
  const replay = replayRecipe(recipe, page(icon));
  assert.deepEqual(replay.units.map((u) => [u.bedrooms, u.area, u.offers[0].rent, u.offers[0].rentIsPerPerson]), [[4, 1251, 725, true], [4, 1275, 725, true]]);
});
