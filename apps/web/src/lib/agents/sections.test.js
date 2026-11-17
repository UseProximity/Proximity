import test from "node:test";
import assert from "node:assert/strict";
import { shortDate, isLaterThan } from "./sections.js";

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

test("a calendar day stamped midnight UTC is still that day", () => {
  assert.equal(shortDate("2027-01-01T00:00:00.000Z"), "Jan 1, 2027");
  assert.equal(shortDate("2027-01-01T00:00:00+00:00"), "Jan 1, 2027");
});

test("a record stamped later than a save is newer than it", () => {
  assert.equal(isLaterThan("2026-11-16T20:00:05.000Z", "2026-11-16T20:00:01.000Z"), true);
  assert.equal(isLaterThan("2026-11-16T20:00:01.000Z", "2026-11-16T20:00:05.000Z"), false);
  // The same instant is not newer: the later write stands.
  assert.equal(isLaterThan("2026-11-16T20:00:01.000Z", "2026-11-16T20:00:01+00:00"), false);
  // Nothing stored, or a stamp that is not a time, never blocks a save.
  assert.equal(isLaterThan(null, "2026-11-16T20:00:01.000Z"), false);
  assert.equal(isLaterThan("soon", "2026-11-16T20:00:01.000Z"), false);
});
