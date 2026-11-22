import test from "node:test";
import assert from "node:assert/strict";
import { buildShareUrl, shareTargets } from "./shareLink.js";

test("adds src with ? when there is no query string", () => {
  assert.equal(buildShareUrl("https://useproximity.org/page"), "https://useproximity.org/page?src=share");
});

test("adds src with & when a query string exists", () => {
  assert.equal(
    buildShareUrl("https://useproximity.org/browse?beds=2"),
    "https://useproximity.org/browse?beds=2&src=share"
  );
});

test("keeps ?listing= and other params in order", () => {
  assert.equal(
    buildShareUrl("https://useproximity.org/browse?listing=abc&unit=u1"),
    "https://useproximity.org/browse?listing=abc&unit=u1&src=share"
  );
});

test("replaces an existing src instead of doubling it", () => {
  assert.equal(
    buildShareUrl("https://useproximity.org/browse?src=lease-push-duc&beds=2"),
    "https://useproximity.org/browse?beds=2&src=share"
  );
});

test("drops preview and hash", () => {
  assert.equal(
    buildShareUrl("https://useproximity.org/browse?listing=abc&preview=1#top"),
    "https://useproximity.org/browse?listing=abc&src=share"
  );
});

test("a bare origin", () => {
  assert.equal(buildShareUrl("https://useproximity.org/"), "https://useproximity.org/?src=share");
});

test("an unparseable value comes back as text", () => {
  assert.equal(buildShareUrl("not a url"), "not a url");
});

test("share targets encode the message", () => {
  const t = shareTargets("https://useproximity.org/p?a=1&src=share", "LOCAL on Delmar");
  assert.ok(t.email.startsWith("mailto:?subject=LOCAL%20on%20Delmar%20on%20Proximity&body="));
  assert.ok(t.sms.startsWith("sms:?&body="));
  assert.ok(t.whatsapp.startsWith("https://wa.me/?text="));
  assert.ok(t.whatsapp.includes(encodeURIComponent("a=1&src=share")));
});
