/*
 * Run with: npm test (from apps/web).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { submitProfile } from "./profileSave.js";

const payload = { name: "Ada Lovelace", role: "landlord", profileComplete: true };
const answer = (status) => async () => ({ ok: status >= 200 && status < 300, status });
const refreshReporting = (profileComplete) => async () => ({ user: { profileComplete } });

test("a successful save is a success and does not need the session", async () => {
  let refreshed = false;
  const saved = await submitProfile(
    payload,
    async () => {
      refreshed = true;
      return null;
    },
    answer(200)
  );
  assert.equal(saved, true);
  assert.equal(refreshed, false);
});

test("the request is a JSON PATCH of the payload", async () => {
  let seen;
  await submitProfile(payload, refreshReporting(true), async (url, init) => {
    seen = { url, init };
    return { ok: true };
  });
  assert.equal(seen.url, "/api/editProfile");
  assert.equal(seen.init.method, "PATCH");
  assert.deepEqual(JSON.parse(seen.init.body), payload);
});

test("a failed answer for a write that committed is still a success", async () => {
  assert.equal(await submitProfile(payload, refreshReporting(true), answer(500)), true);
  assert.equal(await submitProfile(payload, refreshReporting(true), answer(504)), true);
});

test("a lost answer (network error) for a write that committed is still a success", async () => {
  const dropped = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.equal(await submitProfile(payload, refreshReporting(true), dropped), true);
});

test("a save that did not commit is a failure", async () => {
  assert.equal(await submitProfile(payload, refreshReporting(false), answer(500)), false);
  assert.equal(await submitProfile(payload, refreshReporting(false), answer(400)), false);
  assert.equal(await submitProfile(payload, async () => null, answer(401)), false);
});

test("a failed save and a failed session check is a failure, not an exception", async () => {
  const dropped = async () => {
    throw new TypeError("Failed to fetch");
  };
  const refreshThrows = async () => {
    throw new Error("session unreachable");
  };
  assert.equal(await submitProfile(payload, refreshThrows, dropped), false);
  assert.equal(await submitProfile(payload, async () => undefined, answer(500)), false);
});
