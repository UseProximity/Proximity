/*
 * Run with: npm test (from apps/web).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  findApplicationLinks,
  stripApplicationLinks,
  applicationLinkSettingsPath,
  applicationLinkCopy,
  applicationLinkStateOf,
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

test("words around a link do not make it an application link (Wyatt, 2026-11-23)", () => {
  assert.deepEqual(findApplicationLinks("You can apply here: https://forms.gle/AbC123"), []);
  assert.deepEqual(findApplicationLinks("Photos: https://mysite.com/gallery. Let me know if you apply."), []);
  assert.deepEqual(findApplicationLinks("Here is our application:\nhttps://forms.gle/AbC123"), []);
});

test("other links are left to the usual screening", () => {
  assert.deepEqual(findApplicationLinks("Floor plan: https://mysite.com/plans/2br.pdf"), []);
  assert.deepEqual(findApplicationLinks("Directions https://maps.google.com/?q=6811+Waterman"), []);
  assert.deepEqual(findApplicationLinks("Apply on Proximity: https://useproximity.org/listings/abc"), []);
  assert.deepEqual(findApplicationLinks("We're in St. Louis, 1.5 baths, apply soon."), []);
  assert.deepEqual(findApplicationLinks("Email leasing@rentcafe.com"), []);
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

test("four states, four messages, each naming the Contact tab", () => {
  for (const state of ["live", "saved", "missing", "no_leases"]) {
    const { message, actionLabel } = applicationLinkCopy(state);
    assert.match(message, /^Sending applications through chat isn't allowed\..*Contact tab/);
    assert.ok(actionLabel);
    assert.doesNotMatch(message, /\u2014/);
  }
  assert.match(applicationLinkCopy("live").message, /already on this listing/);
  assert.match(applicationLinkCopy("saved").message, /none of your units at this property are live/);
  assert.match(applicationLinkCopy("no_leases").message, /Add a lease for this property/);
  assert.equal(applicationLinkCopy("nonsense").message, applicationLinkCopy("missing").message);
});

test("state comes from the landlord's own leases", () => {
  const unit = { published_at: "2026-01-01", deleted_at: null };
  const live = { application_url: "https://a.com/apply", is_active: true, unavailable: false, published_at: "2026-01-01", listing_units: unit };
  assert.equal(applicationLinkStateOf([]), "no_leases");
  assert.equal(applicationLinkStateOf([{ ...live, application_url: null }]), "missing");
  assert.equal(applicationLinkStateOf([live]), "live");
  assert.equal(applicationLinkStateOf([{ ...live, unavailable: true }]), "saved");
  assert.equal(applicationLinkStateOf([{ ...live, published_at: null }]), "saved");
  assert.equal(applicationLinkStateOf([{ ...live, listing_units: { ...unit, published_at: null } }]), "saved");
  assert.equal(applicationLinkStateOf([{ ...live, is_active: false }, live]), "live");
});

test("strip never cuts into another link that contains the same text", () => {
  assert.equal(
    stripApplicationLinks("Apply: westpine.rentcafe.com. Review: https://news.com/westpine.rentcafe.com-review"),
    "Apply: [removed]. Review: https://news.com/westpine.rentcafe.com-review"
  );
});

test("strip removes the whole link, scheme to path, two-part domains included", () => {
  assert.equal(stripApplicationLinks("Our application is at mysite.co.uk/apply"), "Our application is at [removed]");
  assert.equal(
    stripApplicationLinks("Apply: https://westpine.rentcafe.com/onlineleasing/apply?unit=4#top thanks"),
    "Apply: [removed] thanks"
  );
});

test("a link written with https:// is screened whatever its ending", async () => {
  const { screenChatText, redactChatText } = await import("./moderation.js");
  assert.deepEqual(screenChatText("You can apply here: https://forms.gle/AbC123").reasons, ["external_link"]);
  assert.equal(redactChatText("Form: https://forms.gle/AbC123 thanks").text, "Form: [removed] thanks");
  assert.equal(screenChatText("We're in St. Louis, 1.5 baths").action, "allow");
});
