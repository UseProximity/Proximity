/*
 * Run with: npm test (from apps/web). Covers the source stamped on new
 * accounts (PRD 7.4), the app-request check and when activation is recorded.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeAppRequest, shouldRecordActivation, signupColumns } from "./signup.js";

const SESSION = { id: "11111111-1111-4111-8111-111111111111", source: "instagram", medium: "paid-social", campaign: "2026-11-spring-push" };

test("a live session's source is stamped with a link to the session", () => {
  assert.deepEqual(signupColumns(SESSION), {
    signup_session_id: SESSION.id,
    signup_source: "instagram",
    signup_medium: "paid-social",
    signup_campaign: "2026-11-spring-push",
  });
});

test("a label wins over any session (mobile app, invites)", () => {
  assert.deepEqual(signupColumns(SESSION, "app"), { signup_session_id: null, signup_source: "app", signup_medium: "app", signup_campaign: null });
  assert.equal(signupColumns(null, "invite").signup_source, "invite");
});

test("an unknown label is ignored", () => {
  assert.equal(signupColumns(SESSION, "partner").signup_source, "instagram");
});

test("a web signup with no live session is stamped unknown, never direct", () => {
  assert.deepEqual(signupColumns(null), { signup_session_id: null, signup_source: "unknown", signup_medium: "unknown", signup_campaign: null });
});

test("a session with no campaign stamps a null campaign", () => {
  assert.equal(signupColumns({ id: SESSION.id, source: "direct", medium: "none" }).signup_campaign, null);
});

const headers = (h) => new Headers(h);

test("browser requests are not app requests", () => {
  assert.equal(looksLikeAppRequest(headers({ origin: "https://useproximity.org" })), false);
  assert.equal(looksLikeAppRequest(headers({ "sec-fetch-site": "same-origin" })), false);
});

test("a request with no browser markers is the app", () => {
  assert.equal(looksLikeAppRequest(headers({ "content-type": "application/json" })), true);
  // Node's fetch adds Sec-Fetch-Mode on its own; it is not a browser marker.
  assert.equal(looksLikeAppRequest(headers({ "sec-fetch-mode": "cors" })), true);
  assert.equal(looksLikeAppRequest(null), true);
});

test("activation only for an account whose creation was recorded, and only once", () => {
  assert.equal(shouldRecordActivation(["account_created"]), true);
  assert.equal(shouldRecordActivation(["account_created", "account_activated"]), false);
  // Created before launch: no account_created row, so a sign-in is not "first".
  assert.equal(shouldRecordActivation([]), false);
  assert.equal(shouldRecordActivation(null), false);
});
