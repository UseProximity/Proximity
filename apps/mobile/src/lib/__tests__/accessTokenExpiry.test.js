// Run with `npm test` inside apps/mobile (Node's built-in test runner).
const test = require("node:test");
const assert = require("node:assert/strict");
const { REFRESH_MARGIN_SECONDS, accessTokenNeedsRefresh } = require("../accessTokenExpiry");

const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;
const HEADER = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");

// Only the payload matters here; the signature is never checked.
const tokenWithRawPayload = (raw) => `${HEADER}.${Buffer.from(raw).toString("base64url")}.sig`;
const tokenWith = (payload) => tokenWithRawPayload(JSON.stringify(payload));

test("the margin is 60 seconds", () => {
  assert.equal(REFRESH_MARGIN_SECONDS, 60);
});

test("a token with time to spare needs no refresh", () => {
  assert.equal(accessTokenNeedsRefresh(tokenWith({ exp: NOW_S + 15 * 60 }), NOW_MS), false);
  assert.equal(accessTokenNeedsRefresh(tokenWith({ exp: NOW_S + 61 }), NOW_MS), false);
});

test("an expired or nearly expired token needs a refresh", () => {
  assert.equal(accessTokenNeedsRefresh(tokenWith({ exp: NOW_S - 1 }), NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(tokenWith({ exp: NOW_S }), NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(tokenWith({ exp: NOW_S + 60 }), NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(tokenWith({ exp: NOW_S + 30 }), NOW_MS), true);
});

test("defaults to the current time", () => {
  const nowS = Math.floor(Date.now() / 1000);
  assert.equal(accessTokenNeedsRefresh(tokenWith({ exp: nowS + 600 })), false);
  assert.equal(accessTokenNeedsRefresh(tokenWith({ exp: nowS - 600 })), true);
});

test("a missing token needs a refresh", () => {
  assert.equal(accessTokenNeedsRefresh(null, NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(undefined, NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh("", NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(12345, NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh({ exp: NOW_S + 600 }, NOW_MS), true);
});

test("a malformed token needs a refresh", () => {
  const good = tokenWith({ exp: NOW_S + 600 });
  const [h, p] = good.split(".");
  assert.equal(accessTokenNeedsRefresh(`${h}.${p}`, NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(`${good}.extra`, NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(`${h}..sig`, NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(`${h}.!!!not-base64!!!.sig`, NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh("not a jwt", NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(tokenWithRawPayload("not json"), NOW_MS), true);
});

test("a payload without a usable exp needs a refresh", () => {
  assert.equal(accessTokenNeedsRefresh(tokenWithRawPayload("null"), NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(tokenWithRawPayload("[1,2]"), NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(tokenWithRawPayload('"text"'), NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(tokenWith({ sub: "u1" }), NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(tokenWith({ exp: "9999999999" }), NOW_MS), true);
  assert.equal(accessTokenNeedsRefresh(tokenWith({ exp: null }), NOW_MS), true);
  // JSON has no NaN or Infinity; 1e999 parses to Infinity.
  assert.equal(accessTokenNeedsRefresh(tokenWithRawPayload('{"exp":1e999}'), NOW_MS), true);
});

test("decodes unpadded base64url payloads with - and _", () => {
  // These sub values make the base64url payload contain "-" and "_" and need padding.
  for (const sub of ["??>>??", "~~~", "a?b>c", "ab"]) {
    const token = tokenWith({ sub, exp: NOW_S + 600 });
    assert.equal(accessTokenNeedsRefresh(token, NOW_MS), false, sub);
  }
  const payload = Buffer.from(JSON.stringify({ sub: "??>>??", exp: NOW_S + 600 })).toString("base64url");
  assert.match(payload, /[-_]/);
  assert.doesNotMatch(payload, /=/);
});
