/*
 * Run with: npm test (from apps/web). Covers the campaign tags added to links
 * in our own emails (PRD 7.5).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { tagEmailMessage, tagHtmlLinks, tagTextLinks, tagUrl } from "./emailLinks.js";

const TAGS = "utm_source=proximity-email&utm_medium=email&utm_campaign=chat_alert";

test("our own links get the three tags", () => {
  assert.equal(tagUrl("https://useproximity.org/messages", "chat_alert"), `https://useproximity.org/messages?${TAGS}`);
  assert.equal(tagUrl("https://useproximity.org/listings/abc?listingTab=contact#top", "chat_alert"),
    `https://useproximity.org/listings/abc?listingTab=contact&${TAGS}#top`);
});

test("staging, preview and local hosts count as ours", () => {
  for (const url of ["https://staging.useproximity.org/x", "https://proximity-git-x.vercel.app/x", "http://localhost:3000/x"]) {
    assert.match(tagUrl(url, "chat_alert"), /utm_source=proximity-email/, url);
  }
});

test("other sites, /api/ links, mailto and already-tagged links are left alone", () => {
  for (const url of [
    "https://evil.com/useproximity.org",
    "https://useproximity.org.evil.com/x",
    "https://useproximity.org/api/email/unsubscribe?t=abc",
    "mailto:hello@useproximity.org",
    "https://useproximity.org/guides?utm_source=newsletter",
    "not a url",
  ]) {
    assert.equal(tagUrl(url, "chat_alert"), url, url);
  }
});

test("a base URL's host is accepted as ours", () => {
  assert.match(tagUrl("https://preview.example.dev/x", "mass_email", new Set(["preview.example.dev"])), /utm_campaign=mass_email/);
});

test("HTML hrefs are tagged with & escaped, other markup untouched", () => {
  const html = '<p>Hi</p><a href="https://useproximity.org/messages?thread=1&amp;x=2">Open</a> <a href="https://google.com">G</a>';
  const out = tagHtmlLinks(html, "chat_alert");
  assert.equal(out, `<p>Hi</p><a href="https://useproximity.org/messages?thread=1&amp;x=2&amp;${TAGS.replace(/&/g, "&amp;")}">Open</a> <a href="https://google.com">G</a>`);
});

test("plain-text URLs are tagged and a trailing full stop stays outside", () => {
  assert.equal(tagTextLinks("Reply here: https://useproximity.org/messages.", "chat_alert"), `Reply here: https://useproximity.org/messages?${TAGS}.`);
});

test("only the listed kinds are tagged", () => {
  const msg = { to: "a@b.c", html: '<a href="https://useproximity.org/reset?token=x">Reset</a>', text: "https://useproximity.org/reset?token=x" };
  assert.equal(tagEmailMessage(msg, "password_reset"), msg);
  assert.equal(tagEmailMessage(msg, undefined), msg);
  const tagged = tagEmailMessage(msg, "review_invite");
  assert.match(tagged.html, /utm_campaign=review_invite/);
  assert.match(tagged.text, /utm_campaign=review_invite/);
  assert.equal(tagged.to, "a@b.c");
  assert.notEqual(tagged, msg); // a copy, the caller's message is not changed
  assert.doesNotMatch(msg.html, /utm_/);
});

test("shared kinds are tagged only for a student or parent recipient", () => {
  const msg = { html: '<a href="https://useproximity.org/messages">Open</a>' };
  for (const kind of ["chat_alert", "tour_confirmed", "mass_email"]) {
    assert.equal(tagEmailMessage(msg, kind), msg, `${kind} with no audience`);
    assert.equal(tagEmailMessage(msg, kind, [], "landlord"), msg, `${kind} to a landlord`);
    assert.match(tagEmailMessage(msg, kind, [], "student").html, new RegExp(`utm_campaign=${kind}`));
    assert.match(tagEmailMessage(msg, kind, [], "parent").html, /utm_source=proximity-email/);
  }
  // tour_request only ever goes to a landlord.
  assert.equal(tagEmailMessage(msg, "tour_request", [], "student"), msg);
});
