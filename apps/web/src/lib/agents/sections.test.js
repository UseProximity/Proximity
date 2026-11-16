import test from "node:test";
import assert from "node:assert/strict";
import { shortDate } from "./sections.js";

test("a plain date is the calendar day it names, not the evening before", () => {
  assert.equal(shortDate("2027-01-01"), "Jan 1, 2027");
  assert.equal(shortDate("2026-08-15"), "Aug 15, 2026");
});

test("a moment is shown in St. Louis time", () => {
  // 3am UTC on Nov 10 is 9pm on Nov 9 in St. Louis (UTC-6).
  assert.equal(shortDate("2026-11-10T03:00:00.000Z"), "Nov 9, 2026");
  assert.equal(shortDate(new Date("2026-11-10T03:00:00.000Z")), "Nov 9, 2026");
});

test("nothing or nonsense is null", () => {
  assert.equal(shortDate(null), null);
  assert.equal(shortDate("not a date"), null);
});
