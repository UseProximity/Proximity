// node --test apps/web/src/lib/agents/foundUrls.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { classifyUrl, zillowSlugIsUnit, landlordGave, isFoundSource, sourceRank, pagesToRead, pageLooked } from "./foundUrls.js";

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

const found = (url, site, extra = {}) => ({ url, site, status: "confirmed", page_type: "building", confidence: 0.9, found_by: "address on the web", ...extra });
const src = (url, interval, extra = {}) => ({ id: url, kind: "page", url, check_interval_days: interval, ...extra });

test("found_by: pages the landlord gave before any search", () => {
  assert.equal(landlordGave("agent reads it"), true);
  assert.equal(landlordGave("imported from; agent reads it"), true);
  assert.equal(landlordGave("address on Zillow; address on the web"), false);
  assert.equal(landlordGave(null), false);
});

test("a landlord page that search also found stays the landlord's (rank 1)", () => {
  const f = found("https://koken.com/", "own_site", { found_by: "imported from; agent reads it" });
  assert.equal(isFoundSource(src(f.url, 30), f), false);
  assert.equal(sourceRank(src(f.url, 1), f), 1);
  // A crawled page made before search, matched by a plain search hit.
  const g = found("https://koken.com/floorplans", "own_site");
  assert.equal(isFoundSource(src(g.url, 1), g), false);
  assert.equal(sourceRank(src(g.url, 1), g), 1);
});

test("a page the found reader made ranks by its site, whatever the row's status", () => {
  const z = found("https://www.zillow.com/b/x", "zillow", { status: "rejected" });
  assert.equal(sourceRank(src(z.url, 30), z), 4);
  assert.equal(sourceRank(src("https://own.com/", 30), found("https://own.com/", "own_site")), 2);
  assert.equal(sourceRank({ id: "d", kind: "document" }, undefined), 0);
  assert.equal(sourceRank(src("https://x.com/", 1), undefined), 1);
});

test("pagesToRead: confirmed, ranked, not the landlord's, best first, at most 8", () => {
  const rows = [
    found("https://www.zillow.com/b/a", "zillow"),
    found("https://own.com/", "own_site", { page_type: "home" }),
    found("https://own.com/units", "own_site"),
    found("https://landlord.com/", "own_site", { found_by: "agent reads it" }),
    found("https://crawled.com/p", "own_site"),
    found("https://pending.com/", "own_site", { status: "pending" }),
    found("https://other.com/", "other_portal"),
  ];
  const sources = new Map([["https://crawled.com/p", src("https://crawled.com/p", 1)]]);
  assert.deepEqual(pagesToRead(rows, sources).map((r) => r.url), ["https://own.com/units", "https://own.com/", "https://www.zillow.com/b/a"]);
  const many = Array.from({ length: 12 }, (_, i) => found(`https://www.zillow.com/b/${i}`, "zillow"));
  assert.equal(pagesToRead(many).length, 8);
});

test("pageLooked: any stamp counts, or only one since the run started", () => {
  assert.equal(pageLooked(undefined), false);
  assert.equal(pageLooked({ last_checked_at: null }), false);
  assert.equal(pageLooked({ last_checked_at: "2026-11-01T00:00:00Z" }), true);
  assert.equal(pageLooked({ last_checked_at: "2026-11-01T00:00:00Z" }, "2026-11-02T00:00:00Z"), false);
  assert.equal(pageLooked({ last_checked_at: "2026-11-03T00:00:00Z" }, "2026-11-02T00:00:00Z"), true);
});
