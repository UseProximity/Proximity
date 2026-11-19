/*
 * Run with: npm test (from apps/web). Covers the PRD 7.1 mapping rules and the
 * shared tag cleaner.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cleanTag, normalizeTag, MAX_TAG_LENGTH } from "./tags.js";
import { normalizeReviewSource } from "../reviews/source.js";
import { classifyReferrer, classifyVisit, cleanGclid, hasCampaignSignal, referrerHost } from "./classify.js";

const LINK = { id: "11111111-1111-4111-8111-111111111111", slug: "review-mudd", source: "qr", medium: "offline", campaign: "2026-11-review-push", content: "flyer-mudd" };

// --- tag cleaner -----------------------------------------------------------

test("normalizeTag lowercases and keeps letters, digits, dash, underscore", () => {
  assert.equal(normalizeTag("Instagram"), "instagram");
  assert.equal(normalizeTag("  Spring Lease Push! "), "spring-lease-push");
  assert.equal(normalizeTag("a__b--c"), "a__b-c");
  assert.equal(normalizeTag("--edge_"), "edge");
  assert.equal(normalizeTag(""), null);
  assert.equal(normalizeTag(null), null);
  assert.equal(normalizeTag("!!!"), null);
});

test("normalizeTag caps at 40 characters", () => {
  const long = "x".repeat(60);
  assert.equal(normalizeTag(long).length, MAX_TAG_LENGTH);
});

test("cleanTag flags real changes but not case-only ones", () => {
  assert.deepEqual(cleanTag("Instagram"), { value: "instagram", changed: false });
  assert.deepEqual(cleanTag("spring lease"), { value: "spring-lease", changed: true });
  assert.equal(cleanTag("y".repeat(41)).changed, true);
  assert.deepEqual(cleanTag(undefined), { value: null, changed: false });
});

test("the review flow still cleans tags exactly as before", () => {
  assert.equal(normalizeReviewSource("Flyer Name"), "flyer-name");
  assert.equal(normalizeReviewSource("flyer-name"), "flyer-name");
});

// --- rule 1: registered campaign link ---------------------------------------

test("a registered src link wins over UTMs on the same URL", () => {
  const v = classifyVisit({ params: "?src=review-mudd&utm_source=instagram&utm_medium=paid-social", link: LINK });
  assert.equal(v.classified_from, "link");
  assert.equal(v.source, "qr");
  assert.equal(v.medium, "offline");
  assert.equal(v.campaign, "2026-11-review-push");
  assert.equal(v.content, "flyer-mudd");
  assert.equal(v.link_id, LINK.id);
});

test("a link whose slug does not match the src is ignored", () => {
  const v = classifyVisit({ params: "?src=other-tag", link: LINK });
  assert.equal(v.classified_from, "src");
  assert.equal(v.link_id, null);
});

// --- rule 2: UTMs -----------------------------------------------------------

test("full UTMs are stored normalized (acceptance 1)", () => {
  const v = classifyVisit({ params: "?utm_source=Instagram&utm_medium=Paid-Social&utm_campaign=2026-11-Spring-Lease-Push&utm_content=Story-A&utm_term=WashU Housing" });
  assert.equal(v.classified_from, "utm");
  assert.equal(v.source, "instagram");
  assert.equal(v.medium, "paid-social");
  assert.equal(v.campaign, "2026-11-spring-lease-push");
  assert.equal(v.content, "story-a");
  assert.equal(v.term, "washu-housing");
  assert.equal(v.tags_cleaned, true); // the space in utm_term
});

test("case-only differences do not count as cleaned", () => {
  const v = classifyVisit({ params: "?utm_source=Instagram&utm_medium=cpc" });
  assert.equal(v.tags_cleaned, false);
});

test("UTMs beat an unregistered src", () => {
  const v = classifyVisit({ params: "?src=flyer-x&utm_source=sidechat&utm_medium=paid-social" });
  assert.equal(v.classified_from, "utm");
  assert.equal(v.source, "sidechat");
});

test("UTMs with no source fall back to the referrer for source and medium", () => {
  const v = classifyVisit({ params: "?utm_campaign=2026-11-x", referrer: "https://l.instagram.com/" });
  assert.equal(v.source, "instagram");
  assert.equal(v.medium, "organic-social");
  assert.equal(v.campaign, "2026-11-x");
});

test("UTMs with a source but no medium get medium unknown", () => {
  const v = classifyVisit({ params: "?utm_source=sidechat" });
  assert.equal(v.medium, "unknown");
});

// --- rule 3: unregistered src -----------------------------------------------

test("an unregistered src is qr / offline / <tag> (acceptance 2)", () => {
  const v = classifyVisit({ params: "?src=flyer-mudd" });
  assert.deepEqual([v.source, v.medium, v.campaign, v.classified_from], ["qr", "offline", "flyer-mudd", "src"]);
  assert.equal(v.src_tag, "flyer-mudd");
});

test("an unregistered src beats gclid but gclid is still stored", () => {
  const v = classifyVisit({ params: "?src=flyer-mudd&gclid=Cj0KCQ_abc-123" });
  assert.equal(v.classified_from, "src");
  assert.equal(v.gclid, "Cj0KCQ_abc-123");
});

// --- rule 4: gclid ----------------------------------------------------------

test("gclid alone is google / cpc with the id stored (acceptance 3)", () => {
  const v = classifyVisit({ params: "?gclid=Cj0KCQiA_Ab-12" });
  assert.deepEqual([v.source, v.medium, v.classified_from, v.gclid], ["google", "cpc", "gclid", "Cj0KCQiA_Ab-12"]);
});

test("gclid with UTMs keeps the UTMs and stores the gclid", () => {
  const v = classifyVisit({ params: "?gclid=abc&utm_source=google&utm_medium=cpc&utm_campaign=2026-11-brand" });
  assert.equal(v.classified_from, "utm");
  assert.equal(v.gclid, "abc");
});

test("cleanGclid keeps case and rejects junk", () => {
  assert.equal(cleanGclid("AbC_1-2"), "AbC_1-2");
  assert.equal(cleanGclid("bad value"), null);
  assert.equal(cleanGclid("<script>"), null);
  assert.equal(cleanGclid("x".repeat(201)), null);
});

// --- rule 5: referrer / direct ----------------------------------------------

test("an Instagram referrer is instagram / organic-social (acceptance 4)", () => {
  const v = classifyVisit({ params: "", referrer: "https://l.instagram.com/?u=https%3A%2F%2Fuseproximity.org" });
  assert.deepEqual([v.source, v.medium, v.classified_from, v.referrer_host], ["instagram", "organic-social", "referrer", "l.instagram.com"]);
});

test("no referrer is direct / none (acceptance 4)", () => {
  const v = classifyVisit({ params: "" });
  assert.deepEqual([v.source, v.medium, v.classified_from], ["direct", "none", "direct"]);
});

test("our own domain, localhost and vercel previews count as direct", () => {
  for (const ref of ["https://useproximity.org/browse", "https://www.useproximity.org/", "http://localhost:3000/", "https://proximity-git-x.vercel.app/"]) {
    assert.equal(classifyReferrer(ref).source, "direct", ref);
  }
  assert.equal(classifyReferrer("https://staging.example.com/", ["staging.example.com"]).source, "direct");
});

test("search, email and unknown referrers are classified", () => {
  assert.deepEqual(pick(classifyReferrer("https://www.google.com/")), ["google", "organic-search"]);
  assert.deepEqual(pick(classifyReferrer("https://www.google.co.uk/search?q=x")), ["google", "organic-search"]);
  assert.deepEqual(pick(classifyReferrer("https://mail.google.com/mail/u/0/")), ["gmail", "email"]);
  assert.deepEqual(pick(classifyReferrer("https://outlook.office.com/")), ["outlook", "email"]);
  assert.deepEqual(pick(classifyReferrer("https://t.co/abc")), ["x", "organic-social"]);
  assert.deepEqual(pick(classifyReferrer("https://studlife.com/article")), ["studlife-com", "referral"]);
  assert.equal(classifyReferrer("https://googleblog.com/").source, "googleblog-com");
});

test("referrerHost handles junk", () => {
  assert.equal(referrerHost(""), null);
  assert.equal(referrerHost("not a url at all"), null);
  assert.equal(referrerHost("https://WWW.Instagram.com/x"), "instagram.com");
});

test("hasCampaignSignal is true only for tagged URLs", () => {
  assert.equal(hasCampaignSignal("?utm_source=x"), true);
  assert.equal(hasCampaignSignal("?src=flyer"), true);
  assert.equal(hasCampaignSignal("?gclid=abc"), true);
  assert.equal(hasCampaignSignal("?listing=123"), false);
  assert.equal(hasCampaignSignal(""), false);
  assert.equal(hasCampaignSignal("?src=!!!"), false);
});

function pick(r) {
  return [r.source, r.medium];
}
