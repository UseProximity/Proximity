// node --test apps/web/src/lib/agents/address.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { parseAddress, compareAddress, buildingName, mentionsName } from "./address.js";

test("parseAddress reads number, direction, street, suffix and zip", () => {
  assert.deepEqual(parseAddress("665 S Skinker Blvd, St. Louis, MO 63105"), { from: 665, to: 665, dir: "s", name: "skinker", suffix: "blvd", zip: "63105" });
  assert.deepEqual(parseAddress("7342 Dartmouth Avenue, University City, Missouri 63130, United States"), { from: 7342, to: 7342, dir: null, name: "dartmouth", suffix: "ave", zip: "63130" });
  assert.equal(parseAddress("The Koken"), null);
});

test("compareAddress: exact, neighbour, slug, range, zip conflict", () => {
  const home = "7342 Dartmouth Avenue, University City, Missouri 63130";
  assert.equal(compareAddress(home, "https://www.zillow.com/homedetails/7342-Dartmouth-Ave-Saint-Louis-MO-63130/2733982_zpid").level, "exact");
  assert.equal(compareAddress(home, "7344 Dartmouth Ave, University City, MO 63130").level, "street");
  assert.equal(compareAddress(home, "7342 Dartmouth Ave, Somewhere, MO 64130").level, "none");
  assert.equal(compareAddress("5386 Pershing Avenue, St. Louis, MO 63112", "Central Park - 5386-5390 Pershing Ave Saint Louis, MO").level, "exact");
  assert.equal(compareAddress("5388 Pershing Ave, St. Louis, MO 63112", "Central Park - 5386-5390 Pershing Ave Saint Louis, MO").level, "exact");
  assert.equal(compareAddress("665 S Skinker Blvd, St. Louis, MO 63105", "665 N Skinker Blvd").level, "none");
  assert.equal(compareAddress("2528 Texas Avenue, St. Louis, MO 63104", "https://www.zillow.com/homedetails/2528-Texas-Ave-506-Saint-Louis-MO-63104/2056994984_zpid").level, "exact");
  assert.equal(compareAddress("7350 Lindell Blvd, St. Louis, MO 63130", "https://www.apartments.com/7350-lindell-blvd-university-city-mo/j0del97 7350 Lindell Blvd - University City").level, "exact");
});

test("buildingName and mentionsName", () => {
  assert.equal(buildingName("The Koken", "2528 Texas Avenue"), "The Koken");
  assert.equal(buildingName("7342 Dartmouth Avenue", "7342 Dartmouth Avenue"), null);
  assert.equal(mentionsName("The Koken", "The Koken - 2528 Texas Ave Saint Louis"), true);
  assert.equal(mentionsName("Central Park", "Apartments near Forest Park"), false);
});
