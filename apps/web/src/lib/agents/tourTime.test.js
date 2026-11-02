import test from "node:test";
import assert from "node:assert/strict";
import { slotsWithout, clashesWith, availabilityText } from "./tourTime.js";

// 4pm, 5pm and 6pm Chicago on Wed 11/4/2026 (UTC-6).
const S4 = "2026-11-04T22:00:00.000Z";
const S5 = "2026-11-04T23:00:00.000Z";
const S6 = "2026-11-05T00:00:00.000Z";

test("a tour on the hour takes only that hour", () => {
  assert.deepEqual(slotsWithout([S4, S5, S6], S5), [S4, S6]);
});

test("a tour at half past takes both hours it touches", () => {
  assert.deepEqual(slotsWithout([S4, S5, S6], "2026-11-04T23:30:00.000Z"), [S4]);
});

test("the written-out times follow the slots", () => {
  assert.equal(availabilityText([S4, S5, S6]), "Wednesday 11/4 4pm-7pm");
  assert.equal(availabilityText(slotsWithout([S4, S5, S6], S5)), "Wednesday 11/4 4pm-5pm, 6pm-7pm");
});

test("a start within an hour of a booked tour clashes", () => {
  assert.equal(clashesWith("2026-11-04T23:30:00.000Z", [S5]), true);
  assert.equal(clashesWith(S6, [S5]), false);
  assert.equal(clashesWith(S5, []), false);
});
