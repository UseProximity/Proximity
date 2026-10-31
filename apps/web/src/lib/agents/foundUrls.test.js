// node --test apps/web/src/lib/agents/foundUrls.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { classifyUrl, zillowSlugIsUnit } from "./foundUrls.js";

test("Zillow: houses and buildings vs one apartment, search pages dropped", () => {
  assert.equal(zillowSlugIsUnit("7342-Dartmouth-Ave-Saint-Louis-MO-63130"), false);
  assert.equal(zillowSlugIsUnit("2528-Texas-Ave-506-Saint-Louis-MO-63104"), true);
  assert.equal(zillowSlugIsUnit("7344-Dartmouth-Ave-B-Saint-Louis-MO-63130"), true);
  assert.deepEqual(classifyUrl("https://www.zillow.com/b/central-park-saint-louis-mo-BMSK2Y"), { site: "zillow", pageType: "building" });
  assert.deepEqual(classifyUrl("https://www.zillow.com/apartments/saint-louis-mo/the-koken/ChfS4R"), { site: "zillow", pageType: "building" });
  assert.equal(classifyUrl("https://www.zillow.com/saint-louis-mo/rentals/"), null);
});

test("Apartments.com: property and unit pages kept, city pages dropped", () => {
  assert.deepEqual(classifyUrl("https://www.apartments.com/central-park-saint-louis-mo/skzqrn4"), { site: "apartments_com", pageType: "building" });
  assert.deepEqual(classifyUrl("https://www.apartments.com/7344-dartmouth-ave-university-city-mo-unit-2nd/jgbyx65"), { site: "apartments_com", pageType: "unit" });
  assert.equal(classifyUrl("https://www.apartments.com/off-campus-housing/mo/saint-louis/washington-university-in-st-louis"), null);
  assert.equal(classifyUrl("https://www.apartments.com/saint-louis-mo/pet-friendly/11"), null);
  assert.equal(classifyUrl("https://www.apartments.com/shaw-saint-louis-mo/studios"), null);
});

test("Own sites kept, other portals dropped", () => {
  assert.deepEqual(classifyUrl("https://www.kokenliving.com"), { site: "own_site", pageType: "home" });
  assert.deepEqual(classifyUrl("https://www.kokenliving.com/availableunits"), { site: "own_site", pageType: "building" });
  assert.equal(classifyUrl("https://www.realtor.com/realestateandhomes-detail/7342-Dartmouth-Ave"), null);
  assert.equal(classifyUrl("https://hotpads.com/7350-lindell-blvd-saint-louis-mo-63130-skt8k6/202/pad"), null);
  assert.equal(classifyUrl("https://reslife.washu.edu/off-campus-apartments"), null);
  assert.equal(classifyUrl("https://www.corporatehousing.com/mo/st-louis/the-saum/qlsed0y"), null);
  assert.equal(classifyUrl("not a url"), null);
});
