// node --test apps/web/src/lib/sourceSync/classify.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { isNeverSourceHost, isNeverSourceUrl, classifySourceUrl, sharedSiteRoot } from "./classify.js";

test("reference, news, map and public sites are never a listing's source", () => {
  assert.equal(isNeverSourceUrl("https://en.wikipedia.org/wiki/The_Hill,_St._Louis"), true);
  assert.equal(isNeverSourceUrl("https://en.m.wikipedia.org/wiki/Dogtown"), true);
  assert.equal(isNeverSourceHost("www.stltoday.com"), true);
  assert.equal(isNeverSourceHost("maps.google.com"), true);
  assert.equal(isNeverSourceHost("housing.wustl.edu"), true);
  assert.equal(isNeverSourceHost("www.stlouis-mo.gov"), true);
});

test("landlord sites and portals are still sources", () => {
  assert.equal(isNeverSourceUrl("https://3015tamm.weebly.com/"), false);
  assert.equal(isNeverSourceUrl("https://www.kokenliving.com/availableunits"), false);
  assert.equal(isNeverSourceUrl("https://www.zillow.com/homedetails/x"), false);
  assert.equal(classifySourceUrl("3015tamm.weebly.com").kind, "own_site");
});

test("a bad URL is not called a never-source site", () => {
  assert.equal(isNeverSourceUrl("not a url"), false);
  assert.equal(isNeverSourceHost(""), false);
});

test("a landlord's own Google Sites page can be a source; the rest of Google cannot (PR 447 review)", () => {
  assert.equal(isNeverSourceUrl("https://sites.google.com/view/3015-tamm-apartments"), false);
  assert.equal(isNeverSourceUrl("https://www.google.com/maps/place/3015+Tamm"), true);
  assert.equal(isNeverSourceUrl("https://maps.google.com/?q=3015+Tamm"), true);
  assert.equal(classifySourceUrl("https://sites.google.com/view/3015-tamm-apartments/home")?.kind, "own_site");
  assert.equal(sharedSiteRoot("/view/3015-Tamm-Apartments/home"), "/view/3015-tamm-apartments");
  assert.equal(sharedSiteRoot("/view"), null);
});
