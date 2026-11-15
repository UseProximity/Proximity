// node --test src/lib/sourceImport/readers/realpageOllParse.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { appUrl, feeLine, findRealPageOll, mergeSameRent, mergeWalk, nextSundayCheckAt, offersFor, sayDate, siteIdFromLanding, unitsFromWalk } from "./realpageOllParse.js";

test("findRealPageOll reads the landing page link and the app link", () => {
  assert.deepEqual(findRealPageOll('<a href="https://9030769.onlineleasing.realpage.com/#k=1">Apply</a>'), { propertyId: "9030769", siteId: null });
  assert.deepEqual(findRealPageOll('{"u":"https:\\/\\/1737858.onlineleasing.realpage.com\\/"}'), { propertyId: "1737858", siteId: null });
  assert.deepEqual(findRealPageOll('<a href="https://oll-leasing.loftliving.com/oll/?x=1&amp;siteId=4406694">Lease</a>'), { propertyId: null, siteId: "4406694" });
  assert.equal(findRealPageOll("<p>no portal here</p>"), null);
  assert.equal(findRealPageOll(null), null);
});

test("siteIdFromLanding and appUrl", () => {
  assert.equal(siteIdFromLanding("var propertyId = '9030769'; src='x?siteId=5206058&a=b'"), "5206058");
  assert.equal(siteIdFromLanding("nothing"), null);
  assert.equal(appUrl("5206058"), "https://oll-leasing.loftliving.com/oll/?siteId=5206058");
});

test("sayDate and feeLine", () => {
  assert.equal(sayDate("2026-11-13"), "Nov 13, 2026");
  assert.equal(sayDate("soon"), null);
  assert.equal(feeLine([["Damage Waiver", 18], ["Pest Control", 5]]), "Plus $18/mo Damage Waiver, $5/mo Pest Control");
  assert.equal(feeLine([]), null);
});

test("offersFor makes one lease per price and keeps every length", () => {
  const unit = { plan: "A1", number: "117E", avail: null, twelve: 1742, min: 1432 };
  const quote = { number: "117E", moveIn: "2026-11-13", terms: { 6: 1546, 7: 1536, 12: 1742, 13: 1742 }, services: [["Damage Waiver", 18]] };
  const offers = offersFor(unit, quote, "2026-11-10");
  assert.equal(offers.length, 3);
  assert.deepEqual(offers.find((o) => o.rent === 1742).leaseTermMonths, [12, 13]);
  assert.ok(offers.every((o) => o.availableNow && o.availableFrom === null));
  assert.deepEqual(offers[0].apartments, ["117E"]);
  assert.equal(offers[0].special, "Rent quoted for a Nov 13, 2026 move-in and subject to change. Plus $18/mo Damage Waiver");
});

test("offersFor dates a later apartment and falls back to the twelve month rent", () => {
  const later = offersFor({ number: "405W", avail: "2026-12-31", twelve: 1856, min: 1686 }, null, "2026-11-10");
  assert.equal(later.length, 1);
  assert.equal(later[0].rent, 1856);
  assert.deepEqual(later[0].leaseTermMonths, [12]);
  assert.equal(later[0].availableFrom, "2026-12-31");
  assert.equal(later[0].availableNow, false);
  assert.deepEqual(offersFor({ number: "1", avail: null }, null, "2026-11-10"), []);
});

test("unitsFromWalk groups apartments under their floor plan", () => {
  const walk = {
    plans: [{ id: "11069982", name: "A2", bedrooms: 1, bathrooms: 1, area: 1018, image: "https://x/a2.png" }],
    units: {
      "118E": { plan: "A2", number: "118E", avail: null, twelve: 1863 },
      "320E": { plan: "A2", number: "320E", avail: "2026-11-27", twelve: 1758 },
      "405W": { plan: "A2", number: "405W", avail: "2026-12-31", twelve: 1856 },
    },
    priced: [
      { number: "118E", plan: "A2", moveIn: "2026-11-13", terms: { 6: 1646, 12: 1863 }, services: [["Damage Waiver", 18]] },
      { number: "320E", plan: "A2", moveIn: "2026-11-27", terms: { 6: 1866, 12: 1758, 15: 1748 }, services: [["Damage Waiver", 18]] },
    ],
  };
  const built = unitsFromWalk(walk, "2026-11-10");
  assert.equal(built.units.length, 1);
  assert.equal(built.units[0].name, "A2");
  assert.equal(built.units[0].bedrooms, 1);
  assert.equal(built.units[0].offers.length, 6);
  assert.equal(built.apartments, 3);
  assert.equal(built.quoted, 2);
  assert.deepEqual(built.lengths, [6, 12, 15]);
  assert.ok(built.notes.some((n) => /1 apartment on the leasing portal could not be opened/.test(n)));
  assert.ok(built.notes.some((n) => /Damage Waiver of \$18\/month/.test(n)));
});

test("mergeWalk keeps the first quote of an apartment and drops empty ones", () => {
  const into = { plans: [], units: {}, priced: [{ number: "1", terms: { 12: 1000 } }], log: [] };
  mergeWalk(into, { plans: [{ name: "A" }], units: { 2: { plan: "A", number: "2" } }, priced: [{ number: "1", terms: { 12: 999 } }, { number: "2", terms: { 12: 1200 } }, { number: "3", terms: {} }], log: ["x"] });
  assert.equal(into.priced.length, 2);
  assert.equal(into.priced[0].terms[12], 1000);
  assert.equal(into.plans.length, 1);
  assert.deepEqual(Object.keys(into.units), ["2"]);
});

test("nextSundayCheckAt lands before the next Sunday 09:00 UTC run", () => {
  // Tuesday 2026-11-10 -> Sunday 2026-11-15 09:00 UTC, less six hours.
  assert.equal(nextSundayCheckAt(Date.UTC(2026, 10, 10, 15, 0, 0)), "2026-11-15T03:00:00.000Z");
  // Sunday after the run -> the following Sunday.
  assert.equal(nextSundayCheckAt(Date.UTC(2026, 10, 15, 9, 5, 0)), "2026-11-22T03:00:00.000Z");
  // Saturday night -> tomorrow.
  assert.equal(nextSundayCheckAt(Date.UTC(2026, 10, 14, 23, 0, 0)), "2026-11-15T03:00:00.000Z");
});

test("mergeSameRent names twin apartments once and flags differing lengths", () => {
  const base = { rentIsPerPerson: false, availableNow: true, availableFrom: null, special: "Plus $18/mo Damage Waiver" };
  const twins = mergeSameRent([
    { ...base, rent: 3781, leaseTermMonths: [12], apartments: ["222"] },
    { ...base, rent: 3781, leaseTermMonths: [12], apartments: ["422"] },
    { ...base, rent: 3781, leaseTermMonths: [12], apartments: ["522"], availableNow: false, availableFrom: "2026-11-16" },
    { ...base, rent: 3411, leaseTermMonths: [15], apartments: ["222"] },
  ]);
  assert.equal(twins.length, 2);
  assert.deepEqual(twins[0].apartments, ["222", "422", "522"]);
  assert.equal(twins[0].availableNow, true);
  assert.equal(twins[0].special, "Plus $18/mo Damage Waiver");
  const mixed = mergeSameRent([
    { ...base, rent: 1530, leaseTermMonths: [13], apartments: ["118E"] },
    { ...base, rent: 1530, leaseTermMonths: [9], apartments: ["217W"], availableNow: false, availableFrom: "2026-12-25" },
  ]);
  assert.equal(mixed.length, 1);
  assert.deepEqual(mixed[0].leaseTermMonths, [9, 13]);
  assert.match(mixed[0].special, /vary by apartment/);
});
