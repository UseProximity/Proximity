// Run with `npm test` inside apps/mobile (Node's built-in test runner).
const test = require("node:test");
const assert = require("node:assert/strict");
const { SHARE_SRC, shareOriginFor, buildShareUrl, shareMessage } = require("../shareLink");

const PROD = "https://useproximity.org";
const STAGING = "https://proximity-livid.vercel.app";

test("the staging API shares staging links", () => {
  assert.equal(shareOriginFor("https://proximity-livid.vercel.app"), STAGING);
  assert.equal(shareOriginFor("https://proximity-livid.vercel.app/"), STAGING);
  assert.equal(shareOriginFor("  HTTPS://Proximity-Livid.vercel.app/api "), STAGING);
});

test("every other API shares production links", () => {
  assert.equal(shareOriginFor("https://useproximity.org"), PROD);
  assert.equal(shareOriginFor("https://www.useproximity.org"), PROD);
  assert.equal(shareOriginFor("http://192.168.1.20:3000"), PROD);
  assert.equal(shareOriginFor("http://proximity-livid.vercel.app"), PROD);
  assert.equal(shareOriginFor("https://proximity-livid.vercel.app.evil.com"), PROD);
  assert.equal(shareOriginFor(""), PROD);
  assert.equal(shareOriginFor(undefined), PROD);
});

test("links the public listing page, tagged src=share like web", () => {
  assert.equal(SHARE_SRC, "share");
  assert.equal(buildShareUrl({ origin: PROD, listingId: "abc" }), `${PROD}/listings/abc?src=share`);
  assert.equal(buildShareUrl({ origin: `${PROD}//`, listingId: "abc" }), `${PROD}/listings/abc?src=share`);
  assert.equal(buildShareUrl({ origin: PROD, listingId: "x/y z" }), `${PROD}/listings/x%2Fy%20z?src=share`);
});

test("no link without an origin or a listing id", () => {
  assert.equal(buildShareUrl({ origin: PROD }), "");
  assert.equal(buildShareUrl({ listingId: "abc" }), "");
  assert.equal(buildShareUrl(), "");
});

test("message uses the title, then the address, then the generic line", () => {
  assert.equal(shareMessage({ title: "LOCAL on Delmar", address: "1 Main St" }), "LOCAL on Delmar on Proximity");
  assert.equal(shareMessage({ title: "  ", address: "1 Main St" }), "1 Main St on Proximity");
  assert.equal(shareMessage({}), "Check out this listing on Proximity");
  assert.equal(shareMessage(), "Check out this listing on Proximity");
});
