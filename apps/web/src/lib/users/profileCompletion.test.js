/*
 * Run with: npm test (from apps/web).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { profileCompletionError } from "./profileCompletion.js";

test("the web popup's payload is accepted", () => {
  const body = {
    name: "Ada Lovelace",
    gender: "Female",
    referralSource: "A Friend",
    profileComplete: true,
    role: "student",
    graduation_year: 2028,
    graduation_month: 5,
  };
  assert.equal(profileCompletionError(body), null);
});

test("the installed mobile app's payload is accepted (no gender, referral or month)", () => {
  assert.equal(
    profileCompletionError({ name: "Ada", role: "landlord", profileComplete: true }),
    null
  );
  assert.equal(
    profileCompletionError({ name: "Ada", role: "student", profileComplete: true, graduationYear: 2027 }),
    null
  );
});

test("a missing, blank or non-string name is rejected", () => {
  for (const name of [undefined, null, "", "   ", 42, {}]) {
    assert.equal(profileCompletionError({ name, role: "student" }), "Enter your name.");
  }
});

test("a missing, blank or non-string role is rejected", () => {
  for (const role of [undefined, null, "", "  ", 1]) {
    assert.equal(profileCompletionError({ name: "Ada", role }), "Select who you are.");
  }
});

test("an empty or missing body is rejected", () => {
  assert.equal(profileCompletionError({}), "Enter your name.");
  assert.equal(profileCompletionError(undefined), "Enter your name.");
});
