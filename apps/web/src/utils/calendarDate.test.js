import test from "node:test";
import assert from "node:assert/strict";
import { dayOf, isCalendarDay, dayText } from "./calendarDate.js";

test("dayOf takes the day a string starts with", () => {
  assert.equal(dayOf("2027-01-01"), "2027-01-01");
  assert.equal(dayOf("2027-01-01T05:00:00.000Z"), "2027-01-01");
  assert.equal(dayOf("01/01/2027"), null);
  assert.equal(dayOf("2027-02-31"), null);
  assert.equal(dayOf(null), null);
});

test("a plain date or midnight UTC is a calendar day, a real time is not", () => {
  assert.equal(isCalendarDay("2027-01-01"), true);
  assert.equal(isCalendarDay("2027-01-01T00:00:00.000Z"), true);
  assert.equal(isCalendarDay("2026-11-10T03:00:00.000Z"), false);
  assert.equal(isCalendarDay(new Date("2027-01-01")), false);
});

test("dayText names the day, with or without the year", () => {
  assert.equal(dayText("2026-12-31"), "Dec 31, 2026");
  assert.equal(dayText("2026-12-31", { year: false }), "Dec 31");
  assert.equal(dayText("2026-12-31T00:00:00+00:00"), "Dec 31, 2026");
  assert.equal(dayText("not a date"), null);
  assert.equal(dayText(null), null);
});
