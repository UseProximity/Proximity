/*
 * Run with: npm test (from apps/web). Campaign parameters carried across our
 * own server-side redirects (/messages, /login).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { withCampaignParams } from "./tags.js";

const EMAIL = { utm_source: "proximity-email", utm_medium: "email", utm_campaign: "chat_alert" };

test("campaign params are appended to a path with its own query", () => {
  assert.equal(
    withCampaignParams("/?messages=1&thread=abc", { thread: "abc", ...EMAIL }),
    "/?messages=1&thread=abc&utm_source=proximity-email&utm_medium=email&utm_campaign=chat_alert"
  );
});

test("src and gclid are carried, other params are not", () => {
  assert.equal(withCampaignParams("/review", { src: "flyer-mudd", gclid: "g1", tab: "x" }), "/review?src=flyer-mudd&gclid=g1");
});

test("nothing to carry leaves the path untouched", () => {
  assert.equal(withCampaignParams("/?messages=1", { thread: "abc" }), "/?messages=1");
  assert.equal(withCampaignParams("/dashboard", undefined), "/dashboard");
});

test("a value already on the path wins, and a hash stays last", () => {
  assert.equal(withCampaignParams("/guides?utm_source=keep#top", EMAIL), "/guides?utm_source=keep&utm_medium=email&utm_campaign=chat_alert#top");
});

test("an encoded callbackUrl is kept intact", () => {
  const login = `/login?callbackUrl=${encodeURIComponent("/?messages=1&thread=abc")}`;
  const out = withCampaignParams(login, EMAIL);
  assert.equal(new URL(out, "http://x").searchParams.get("callbackUrl"), "/?messages=1&thread=abc");
  assert.equal(new URL(out, "http://x").searchParams.get("utm_campaign"), "chat_alert");
});

test("array values (repeated params) use the first one", () => {
  assert.equal(withCampaignParams("/", { utm_source: ["a", "b"] }), "/?utm_source=a");
});
