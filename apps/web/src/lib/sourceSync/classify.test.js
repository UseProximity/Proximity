// node --test apps/web/src/lib/sourceSync/classify.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { isNeverSourceHost, isNeverSourceUrl, classifySourceUrl } from "./classify.js";

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
