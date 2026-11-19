/*
 * Run with: npm test (from apps/web). Covers the campaign link rules (PRD 7.8,
 * 7.9): validation, slug suggestions, own-domain destinations and the /go
 * redirect target.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  campaignPrefix, fullLink, goRedirectPath, nextFreeSlug, normalizeDestination, shortLink, suggestSlug, validateLinkInput, withSrc,
} from "./links.js";

const VALID = {
  name: "Mudd review flyer, fall",
  slug: "review-mudd",
  source: "qr",
  medium: "offline",
  campaign: "2026-11-review-push",
  content: "flyer-mudd",
  destination_path: "/review",
};

test("a valid link passes and is cleaned", () => {
  const { value, errors } = validateLinkInput({ ...VALID, slug: "Review Mudd", source: "QR", content: "" });
  assert.deepEqual(errors, {});
  assert.equal(value.slug, "review-mudd");
  assert.equal(value.source, "qr");
  assert.equal(value.content, null);
  assert.equal(value.destination_path, "/review");
});

test("missing fields are reported per field", () => {
  const { errors } = validateLinkInput({});
  assert.deepEqual(Object.keys(errors).sort(), ["campaign", "destination_path", "medium", "name", "slug", "source"]);
});

test("medium must come from the convention list", () => {
  assert.ok(validateLinkInput({ ...VALID, medium: "billboard" }).errors.medium);
});

test("campaign must be <yyyy-mm>-<short-name>", () => {
  assert.ok(validateLinkInput({ ...VALID, campaign: "spring-push" }).errors.campaign);
  assert.ok(validateLinkInput({ ...VALID, campaign: "2026-13-x" }).errors.campaign);
  assert.ok(validateLinkInput({ ...VALID, campaign: "2026-11-" }).errors.campaign);
  assert.equal(validateLinkInput({ ...VALID, campaign: "2026-11-Spring Lease Push" }).value.campaign, "2026-11-spring-lease-push");
});

test("partial edits only check the fields sent and never take a slug", () => {
  const { value, errors } = validateLinkInput({ destination_path: "/browse" }, { partial: true });
  assert.deepEqual(errors, {});
  assert.deepEqual(value, { destination_path: "/browse" });
  assert.equal(validateLinkInput({ slug: "x" }, { partial: true }).value.slug, undefined);
});

test("destinations must be our own domain (edge case 37)", () => {
  assert.deepEqual(normalizeDestination("/browse?beds=2"), { path: "/browse?beds=2", error: null });
  assert.equal(normalizeDestination("https://useproximity.org/guides/x").path, "/guides/x");
  assert.equal(normalizeDestination("www.useproximity.org/lease-check").path, "/lease-check");
  for (const bad of ["https://evil.com/", "//evil.com", "javascript:alert(1)", "/a b", "/a\\b", "", "https://useproximity.org.evil.com/"]) {
    assert.ok(normalizeDestination(bad).error, bad);
  }
});

test("a destination's own src is dropped (the link adds its own)", () => {
  assert.equal(normalizeDestination("/review?src=old&x=1").path, "/review?x=1");
});

test("slug suggestions and the next free slug (edge case 30)", () => {
  assert.equal(suggestSlug("Mudd review flyer, fall"), "mudd-review-flyer-fall");
  assert.equal(nextFreeSlug("review-mudd", ["review-mudd"]), "review-mudd-2");
  assert.equal(nextFreeSlug("review-mudd", ["review-mudd", "review-mudd-2"]), "review-mudd-3");
  assert.equal(nextFreeSlug("free", ["other"]), "free");
  assert.equal(nextFreeSlug("x".repeat(40), ["x".repeat(40)]).length, 40);
});

test("campaignPrefix is <yyyy-mm>-", () => {
  assert.equal(campaignPrefix(new Date(2026, 0, 5)), "2026-01-");
});

test("short and full links", () => {
  assert.equal(shortLink("review-mudd"), "https://useproximity.org/go/review-mudd");
  assert.equal(fullLink("/review", "review-mudd"), "https://useproximity.org/review?src=review-mudd");
  assert.equal(fullLink("/browse?beds=2", "ig", "http://localhost:3000"), "http://localhost:3000/browse?beds=2&src=ig");
});

test("/go carries the incoming query and sets src", () => {
  assert.equal(goRedirectPath({ destination_path: "/review" }, "review-mudd", "?utm_content=x"), "/review?utm_content=x&src=review-mudd");
  assert.equal(goRedirectPath({ destination_path: "/browse?beds=2" }, "ig", "?src=spoofed"), "/browse?beds=2&src=ig");
});

test("an unknown /go slug goes home with src kept (edge case 36)", () => {
  assert.equal(goRedirectPath(null, "not-a-real-slug", ""), "/?src=not-a-real-slug");
});

test("withSrc keeps the destination's query", () => {
  assert.equal(withSrc("/listings/abc?tab=photos", "s"), "/listings/abc?tab=photos&src=s");
});
