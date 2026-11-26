/*
 * Run with: npm test (from apps/web). Uses Node's built-in test runner, so there
 * is no extra dependency. Every function takes `now`, so no test waits for real time.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_MAX_FAILURES,
  IP_MAX_FAILURES,
  FAILURE_WINDOW_MS,
  LOCK_MS,
  MAX_TRACKED_KEYS,
  checkLoginLock,
  recordLoginFailure,
  recordLoginSuccess,
  clientIp,
  _resetLoginThrottle,
  _trackedKeyCounts,
} from "./loginThrottle.js";

const T0 = 1_000_000_000;
const EMAIL = "student@wustl.edu";

beforeEach(() => _resetLoginThrottle());

function fail(id, n, start = T0, stepMs = 1000) {
  for (let i = 0; i < n; i++) recordLoginFailure(id, start + i * stepMs);
}

test("email locks on exactly the threshold, not one failure earlier", () => {
  fail({ email: EMAIL }, EMAIL_MAX_FAILURES - 1);
  assert.equal(checkLoginLock({ email: EMAIL }, T0 + 10_000).locked, false);
  recordLoginFailure({ email: EMAIL }, T0 + 10_000);
  assert.equal(checkLoginLock({ email: EMAIL }, T0 + 10_001).locked, true);
});

test("lock reports a sensible Retry-After and expires at the exact boundary", () => {
  fail({ email: EMAIL }, EMAIL_MAX_FAILURES);
  const lockedAt = T0 + (EMAIL_MAX_FAILURES - 1) * 1000;
  const during = checkLoginLock({ email: EMAIL }, lockedAt + 1000);
  assert.equal(during.locked, true);
  assert.equal(during.retryAfterSec, LOCK_MS / 1000 - 1);
  assert.equal(checkLoginLock({ email: EMAIL }, lockedAt + LOCK_MS - 1).locked, true);
  assert.equal(checkLoginLock({ email: EMAIL }, lockedAt + LOCK_MS).locked, false);
});

test("failures older than the window do not count toward a lock", () => {
  fail({ email: EMAIL }, EMAIL_MAX_FAILURES - 1);
  const later = T0 + FAILURE_WINDOW_MS + 5000;
  recordLoginFailure({ email: EMAIL }, later);
  assert.equal(checkLoginLock({ email: EMAIL }, later + 1).locked, false);
});

test("a fresh counter starts after a lock lapses", () => {
  fail({ email: EMAIL }, EMAIL_MAX_FAILURES);
  const after = T0 + LOCK_MS + 60_000;
  assert.equal(checkLoginLock({ email: EMAIL }, after).locked, false);
  fail({ email: EMAIL }, EMAIL_MAX_FAILURES - 1, after);
  assert.equal(checkLoginLock({ email: EMAIL }, after + 10_000).locked, false);
});

test("refused attempts do not extend an active lock", () => {
  fail({ email: EMAIL }, EMAIL_MAX_FAILURES);
  const lockedAt = T0 + (EMAIL_MAX_FAILURES - 1) * 1000;
  recordLoginFailure({ email: EMAIL }, lockedAt + LOCK_MS - 1000);
  recordLoginFailure({ email: EMAIL }, lockedAt + LOCK_MS - 500);
  assert.equal(checkLoginLock({ email: EMAIL }, lockedAt + LOCK_MS).locked, false);
});

test("checking a lock never records a failure", () => {
  for (let i = 0; i < 50; i++) checkLoginLock({ email: EMAIL, ip: "1.1.1.1" }, T0 + i);
  assert.deepEqual(_trackedKeyCounts(), { email: 0, ip: 0 });
});

test("success clears the email counter", () => {
  fail({ email: EMAIL }, EMAIL_MAX_FAILURES - 1);
  recordLoginSuccess({ email: EMAIL });
  recordLoginFailure({ email: EMAIL }, T0 + 10_000);
  assert.equal(checkLoginLock({ email: EMAIL }, T0 + 10_001).locked, false);
});

test("success does not clear the IP counter", () => {
  const ip = "9.9.9.9";
  fail({ email: "a@x.edu", ip }, IP_MAX_FAILURES - 1);
  recordLoginSuccess({ email: "mine@x.edu", ip });
  recordLoginFailure({ email: "b@x.edu", ip }, T0 + 60_000);
  assert.equal(checkLoginLock({ email: "c@x.edu", ip }, T0 + 60_001).locked, true);
});

test("one IP failing across many emails locks the IP, and every email behind it", () => {
  const ip = "2.2.2.2";
  for (let i = 0; i < IP_MAX_FAILURES; i++) {
    recordLoginFailure({ email: `victim${i}@x.edu`, ip }, T0 + i);
  }
  const res = checkLoginLock({ email: "never-seen@x.edu", ip }, T0 + 1000);
  assert.equal(res.locked, true);
  assert.equal(checkLoginLock({ email: "never-seen@x.edu", ip: "3.3.3.3" }, T0 + 1000).locked, false);
});

test("email lock holds regardless of which IP the attempt comes from", () => {
  fail({ email: EMAIL, ip: "4.4.4.4" }, EMAIL_MAX_FAILURES);
  assert.equal(checkLoginLock({ email: EMAIL, ip: "5.5.5.5" }, T0 + 6000).locked, true);
});

test("email keys ignore case and surrounding whitespace", () => {
  recordLoginFailure({ email: "  Student@WUSTL.edu " }, T0);
  recordLoginFailure({ email: "student@wustl.edu" }, T0 + 1);
  recordLoginFailure({ email: "STUDENT@wustl.EDU" }, T0 + 2);
  recordLoginFailure({ email: "student@wustl.edu" }, T0 + 3);
  recordLoginFailure({ email: "Student@wustl.edu" }, T0 + 4);
  assert.equal(checkLoginLock({ email: "student@wustl.edu" }, T0 + 5).locked, true);
});

test("a missing IP skips the IP counter and the email counter still works", () => {
  for (let i = 0; i < IP_MAX_FAILURES + 5; i++) {
    recordLoginFailure({ email: `u${i}@x.edu`, ip: "" }, T0 + i);
  }
  assert.equal(_trackedKeyCounts().ip, 0);
  assert.equal(checkLoginLock({ email: "fresh@x.edu", ip: "" }, T0 + 100).locked, false);
  fail({ email: EMAIL, ip: "" }, EMAIL_MAX_FAILURES);
  assert.equal(checkLoginLock({ email: EMAIL, ip: "" }, T0 + 6000).locked, true);
});

test("an empty or missing email is not tracked and never locks", () => {
  recordLoginFailure({ email: "" }, T0);
  recordLoginFailure({ email: undefined }, T0);
  recordLoginFailure({ email: null }, T0);
  assert.equal(_trackedKeyCounts().email, 0);
  assert.equal(checkLoginLock({ email: "" }, T0 + 1).locked, false);
});

test("an unknown email and a real email lock identically", () => {
  fail({ email: "real@wustl.edu" }, EMAIL_MAX_FAILURES);
  fail({ email: "doesnotexist@nowhere.test" }, EMAIL_MAX_FAILURES);
  const real = checkLoginLock({ email: "real@wustl.edu" }, T0 + 6000);
  const unknown = checkLoginLock({ email: "doesnotexist@nowhere.test" }, T0 + 6000);
  assert.deepEqual(real, unknown);
});

test("the tracked-key cap holds under a flood and keeps an active lock", () => {
  fail({ email: EMAIL }, EMAIL_MAX_FAILURES);
  for (let i = 0; i < MAX_TRACKED_KEYS + 500; i++) {
    recordLoginFailure({ email: `flood${i}@x.edu` }, T0 + 10_000 + i);
  }
  assert.ok(_trackedKeyCounts().email <= MAX_TRACKED_KEYS);
  assert.equal(checkLoginLock({ email: EMAIL }, T0 + 20_000).locked, true);
});

test("expired entries are swept so memory does not grow forever", () => {
  for (let i = 0; i < 100; i++) recordLoginFailure({ email: `old${i}@x.edu`, ip: `10.0.0.${i}` }, T0);
  assert.equal(_trackedKeyCounts().email, 100);
  checkLoginLock({ email: "trigger@x.edu" }, T0 + FAILURE_WINDOW_MS + 120_000);
  assert.deepEqual(_trackedKeyCounts(), { email: 0, ip: 0 });
});

test("clientIp takes the first x-forwarded-for entry, then x-real-ip, else empty", () => {
  const h = (o) => new Headers(o);
  assert.equal(clientIp(h({ "x-forwarded-for": "7.7.7.7, 10.0.0.1" })), "7.7.7.7");
  assert.equal(clientIp(h({ "x-real-ip": "8.8.8.8" })), "8.8.8.8");
  assert.equal(clientIp(h({})), "");
  assert.equal(clientIp(undefined), "");
});

test("two separately loaded copies of the module share one set of counters", async () => {
  // Next bundles the web and mobile login routes separately, each loading its own
  // copy of this module. State on globalThis keeps them from counting separately.
  const copy = await import("./loginThrottle.js?second-bundle");
  fail({ email: EMAIL }, EMAIL_MAX_FAILURES - 1);
  copy.recordLoginFailure({ email: EMAIL }, T0 + 10_000);
  assert.equal(checkLoginLock({ email: EMAIL }, T0 + 10_001).locked, true);
  assert.equal(copy.checkLoginLock({ email: EMAIL }, T0 + 10_001).locked, true);
});
