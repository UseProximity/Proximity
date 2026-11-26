/*
 * Run with: npm test (from apps/web). Covers the canonical outcome list, the
 * dedupe keys behind the PRD "Counted" column, the visit paths and the
 * beacon rate limit.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OUTCOMES, OUTCOME_NAMES, buildDedupeKey, isOutcome, visitOutcomesForPath } from "./outcomes.js";
import { BEACON_LIMIT, BEACON_WINDOW_MS, _resetBeaconRateLimit, beaconRateLimited } from "./rateLimit.js";

const S = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const L = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const L2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = Date.UTC(2026, 10, 17, 15, 0, 0);

test("the 13 canonical outcomes match the DB check constraint", () => {
  assert.deepEqual(OUTCOME_NAMES.sort(), [
    "account_activated", "account_created", "application_started", "application_submitted",
    "guides_visit", "hub_visit", "landlord_message", "lease_check_completed", "lease_check_started",
    "proxy_question", "review_submitted", "tour_requested", "waitlist_click",
  ]);
  assert.equal(isOutcome("sign_up"), false);
});

test("tiers match the generated column", () => {
  const tiers = Object.fromEntries(Object.entries(OUTCOMES).map(([k, v]) => [k, v.tier]));
  assert.equal(tiers.account_created, "account");
  assert.equal(tiers.tour_requested, "inquiry");
  assert.equal(tiers.application_submitted, "application");
  assert.equal(tiers.waitlist_click, "engagement");
});

test("every key starts with the outcome name", () => {
  for (const name of OUTCOME_NAMES) {
    const key = buildDedupeKey(name, { sessionId: S, userId: U, subjectId: L, now: NOW });
    assert.ok(key.startsWith(`${name}:`), name);
  }
});

test("Proxy questions on one listing in one session collapse to one (acceptance 8)", () => {
  const a = buildDedupeKey("proxy_question", { sessionId: S, subjectId: L });
  const b = buildDedupeKey("proxy_question", { sessionId: S, subjectId: L });
  assert.equal(a, b);
  assert.notEqual(a, buildDedupeKey("proxy_question", { sessionId: S, subjectId: L2 }));
});

test("different inquiry channels on one listing never collapse (acceptance 9)", () => {
  const proxy = buildDedupeKey("proxy_question", { sessionId: S, subjectId: L });
  const landlord = buildDedupeKey("landlord_message", { sessionId: S, subjectId: L });
  const tour = buildDedupeKey("tour_requested", { sessionId: S, subjectId: L });
  assert.equal(new Set([proxy, landlord, tour]).size, 3);
});

test("account outcomes are once per account", () => {
  assert.equal(buildDedupeKey("account_created", { userId: U }), `account_created:${U}`);
  assert.equal(buildDedupeKey("account_created", { sessionId: S }), null);
});

test("guides and hub visits are once per session", () => {
  assert.equal(buildDedupeKey("guides_visit", { sessionId: S }), `guides_visit:s:${S}`);
  assert.equal(buildDedupeKey("hub_visit", {}), null);
});

test("application_submitted is once per application", () => {
  assert.equal(buildDedupeKey("application_submitted", { sessionId: S, subjectId: L }), `application_submitted:${L}`);
  assert.equal(buildDedupeKey("application_submitted", { sessionId: S }), null);
});

test("reviews and lease checks count every one", () => {
  assert.equal(buildDedupeKey("review_submitted", { subjectId: L }), `review_submitted:${L}`);
  const a = buildDedupeKey("lease_check_started", { uuid: () => "x1" });
  const b = buildDedupeKey("lease_check_started", { uuid: () => "x2" });
  assert.notEqual(a, b);
});

test("sessionless outcomes fall back to user and day", () => {
  const k = buildDedupeKey("tour_requested", { userId: U, subjectId: L, now: NOW });
  assert.equal(k, `tour_requested:u:${U}:2026-11-17:${L}`);
  const nextDay = buildDedupeKey("tour_requested", { userId: U, subjectId: L, now: NOW + 86_400_000 });
  assert.notEqual(k, nextDay);
});

test("per-listing outcomes need a listing", () => {
  assert.equal(buildDedupeKey("waitlist_click", { sessionId: S }), null);
});

test("unknown outcomes get no key", () => {
  assert.equal(buildDedupeKey("nope", { sessionId: S }), null);
});

test("visit outcomes by path (acceptance 14, edge case 21)", () => {
  assert.deepEqual(visitOutcomesForPath("/guides"), ["guides_visit"]);
  assert.deepEqual(visitOutcomesForPath("/guides/first-lease?x=1"), ["guides_visit"]);
  assert.deepEqual(visitOutcomesForPath("/CampusHub"), ["hub_visit"]);
  assert.deepEqual(visitOutcomesForPath("/washu/the-lofts"), ["hub_visit"]);
  assert.deepEqual(visitOutcomesForPath("/guidestar"), []);
  assert.deepEqual(visitOutcomesForPath("/browse"), []);
  assert.deepEqual(visitOutcomesForPath(""), []);
});

beforeEach(() => _resetBeaconRateLimit());

test("the beacon rate limit trips at the limit and resets after the window", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < BEACON_LIMIT; i++) assert.equal(beaconRateLimited("1.2.3.4", t0 + i), false);
  assert.equal(beaconRateLimited("1.2.3.4", t0 + BEACON_LIMIT), true);
  assert.equal(beaconRateLimited("5.6.7.8", t0), false, "other IPs unaffected");
  assert.equal(beaconRateLimited("1.2.3.4", t0 + BEACON_WINDOW_MS + BEACON_LIMIT + 1), false);
});

test("beacon limits: by session when there is one, so a shared campus IP is not throttled", async () => {
  const { beaconRequestLimited, SESSION_LIMIT, NO_COOKIE_IP_LIMIT } = await import("./rateLimit.js");
  _resetBeaconRateLimit();
  const t0 = 1_000_000;
  // 20 students on one IP, each well under their own session limit.
  for (let s = 0; s < 20; s++) {
    for (let i = 0; i < 30; i++) assert.equal(beaconRequestLimited({ ip: "9.9.9.9", sessionId: `sess-${s}` }, t0 + s * 100 + i), false);
  }
  // One session past its own limit is stopped; the others are not.
  for (let i = 30; i < SESSION_LIMIT; i++) beaconRequestLimited({ ip: "9.9.9.9", sessionId: "sess-0" }, t0 + 5000 + i);
  assert.equal(beaconRequestLimited({ ip: "9.9.9.9", sessionId: "sess-0" }, t0 + 9000), true);
  assert.equal(beaconRequestLimited({ ip: "9.9.9.9", sessionId: "sess-1" }, t0 + 9001), false);
  // No cookie: the per-IP limit applies.
  _resetBeaconRateLimit();
  for (let i = 0; i < NO_COOKIE_IP_LIMIT; i++) beaconRequestLimited({ ip: "8.8.8.8", sessionId: null }, t0 + i);
  assert.equal(beaconRequestLimited({ ip: "8.8.8.8", sessionId: null }, t0 + NO_COOKIE_IP_LIMIT), true);
  _resetBeaconRateLimit();
});
