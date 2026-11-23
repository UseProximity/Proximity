import test from "node:test";
import assert from "node:assert/strict";
import { buildShareUrl, shareTargets } from "./shareLink.js";

const O = "https://useproximity.org";
const share = (currentHref, listingId = "abc") => buildShareUrl({ origin: O, listingId, currentHref });

test("always links the public listing page, tagged src=share", () => {
  assert.equal(share(`${O}/browse?listing=abc`), `${O}/listings/abc?src=share`);
});

test("an admin dashboard address still sends the public page", () => {
  assert.equal(share(`${O}/dashboard/admin?listing=abc&tab=listings`), `${O}/listings/abc?src=share`);
});

test("keeps the selected unit", () => {
  assert.equal(share(`${O}/browse?listing=abc&unit=u1`), `${O}/listings/abc?unit=u1&src=share`);
  assert.equal(share(`${O}/listings/abc?unit=u1`), `${O}/listings/abc?unit=u1&src=share`);
});

test("drops the sharer's utm tags, gclid, src, preview and hash", () => {
  assert.equal(
    share(`${O}/browse?utm_source=ig&utm_medium=paid-social&utm_campaign=x&utm_content=a&utm_term=b&gclid=Cj0abc&src=lease-push&preview=1&listing=abc#top`),
    `${O}/listings/abc?src=share`
  );
});

test("encodes the listing id and unit", () => {
  assert.equal(share(`${O}/browse?unit=a%20b`, "x/y"), `${O}/listings/x%2Fy?unit=a+b&src=share`);
});

test("uses the sharer's origin, without a trailing slash", () => {
  assert.equal(
    buildShareUrl({ origin: "http://localhost:3000/", listingId: "abc", currentHref: "http://localhost:3000/browse" }),
    "http://localhost:3000/listings/abc?src=share"
  );
});

test("an unreadable address still shares the listing", () => {
  assert.equal(share("not a url"), `${O}/listings/abc?src=share`);
});

test("no listing id gives no link", () => {
  assert.equal(buildShareUrl({ origin: O, currentHref: `${O}/browse` }), "");
});

test("share targets encode the message", () => {
  const t = shareTargets("https://useproximity.org/p?a=1&src=share", "LOCAL on Delmar");
  assert.ok(t.email.startsWith("mailto:?subject=LOCAL%20on%20Delmar%20on%20Proximity&body="));
  assert.ok(t.sms.startsWith("sms:?&body="));
  assert.ok(t.whatsapp.startsWith("https://wa.me/?text="));
  assert.ok(t.whatsapp.includes(encodeURIComponent("a=1&src=share")));
});
