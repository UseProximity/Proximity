/*
 * Run with: npm test (from apps/web).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  findApplicationLinks,
  stripApplicationLinks,
  applicationLinkSettingsPath,
  applicationLinkMessage,
} from "./applicationLinks.js";

test("portal hosts count, subdomains included", () => {
  assert.deepEqual(findApplicationLinks("Here you go: https://westpine.rentcafe.com/onlineleasing"), [
    "https://westpine.rentcafe.com/onlineleasing",
  ]);
  assert.deepEqual(findApplicationLinks("revivalstl.appfolio.com/listings"), ["revivalstl.appfolio.com/listings"]);
  assert.equal(findApplicationLinks("https://www.rentspree.com/x/abc").length, 1);
});

test("a URL that says apply or application counts", () => {
  assert.equal(findApplicationLinks("https://mysite.com/apply-now").length, 1);
  assert.equal(findApplicationLinks("https://mysite.com/onlineapplication?id=4").length, 1);
  assert.equal(findApplicationLinks("https://forms.gle/rentalapp").length, 1);
});

test("a link in a sentence about applying counts", () => {
  assert.equal(findApplicationLinks("You can apply here: https://forms.gle/AbC123").length, 1);
  assert.equal(findApplicationLinks("Please fill out the app at docs.google.com/forms/d/xyz. Thanks!").length, 1);
  assert.equal(findApplicationLinks("Here is our application:\nhttps://forms.gle/AbC123").length, 1);
});

test("other links are left to the usual screening", () => {
  assert.deepEqual(findApplicationLinks("Floor plan: https://mysite.com/plans/2br.pdf"), []);
  assert.deepEqual(findApplicationLinks("Directions https://maps.google.com/?q=6811+Waterman"), []);
  assert.deepEqual(findApplicationLinks("Apply on Proximity: https://useproximity.org/listings/abc"), []);
  assert.deepEqual(findApplicationLinks("We're in St. Louis, 1.5 baths, apply soon."), []);
  assert.deepEqual(findApplicationLinks("Email leasing@rentcafe.com"), []);
});

test("the sentence check stays in its own sentence", () => {
  // "apply" is in the next sentence, not the link's.
  assert.deepEqual(findApplicationLinks("Photos are at https://mysite.com/gallery. Let me know if you apply."), []);
});

test("trailing punctuation is not part of the link", () => {
  assert.deepEqual(findApplicationLinks("Apply at https://mysite.com/apply."), ["https://mysite.com/apply"]);
});

test("strip cuts only application links", () => {
  assert.equal(
    stripApplicationLinks("Apply at https://mysite.com/apply. Photos: https://mysite.com/gallery"),
    "Apply at [removed]. Photos: https://mysite.com/gallery"
  );
});

test("settings path deep links to the property's application field", () => {
  assert.equal(
    applicationLinkSettingsPath("abc"),
    "/dashboard/landlord?tab=properties&property=abc&focus=application-link"
  );
});

test("message names the Contact tab, either way", () => {
  assert.match(applicationLinkMessage({ hasLink: false }), /isn't allowed.*Add your application link.*Contact tab/);
  assert.match(applicationLinkMessage({ hasLink: true }), /already on this listing.*Contact tab/);
  assert.doesNotMatch(applicationLinkMessage(), /\u2014/);
});
