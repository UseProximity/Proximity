/*
 * Business days on the America/Chicago calendar, for autopay: an invoice sent on
 * a given day is charged a fixed number of business days later. Weekends and the
 * US Federal Reserve's bank holidays are skipped, because a bank debit (ACH)
 * cannot settle on them.
 *
 * Fed holiday rules: a holiday on a Sunday is observed on the Monday; one on a
 * Saturday is not moved (the Fed is simply closed that Saturday), so the Friday
 * before stays a business day.
 *
 * Pure, with dates handled as "YYYY-MM-DD" strings in Chicago time.
 */
import { BILLING_TIME_ZONE } from "./constants.js";

// "YYYY-MM-DD" of an instant, in Chicago.
export function chicagoDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BILLING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
}

const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday

// The nth (1-based) given weekday of a month, or the last one when n is -1.
function nthWeekday(y, m, wd, n) {
  if (n > 0) {
    const first = weekday(y, m, 1);
    return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = weekday(y, m, lastDay);
  return lastDay - ((last - wd + 7) % 7);
}

// The Fed's holidays observed in year y, as "YYYY-MM-DD".
export function fedHolidays(y) {
  const fixed = [
    [1, 1], // New Year's Day
    [6, 19], // Juneteenth
    [7, 4], // Independence Day
    [11, 11], // Veterans Day
    [12, 25], // Christmas Day
  ].map(([m, d]) => (weekday(y, m, d) === 0 ? ymd(y, m, d + 1) : weekday(y, m, d) === 6 ? null : ymd(y, m, d)));
  const floating = [
    [1, 1, 3], // Martin Luther King Jr. Day: third Monday of January
    [2, 1, 3], // Washington's Birthday
    [5, 1, -1], // Memorial Day
    [9, 1, 1], // Labor Day
    [10, 1, 2], // Columbus Day
    [11, 4, 4], // Thanksgiving: fourth Thursday
  ].map(([m, wd, n]) => ymd(y, m, nthWeekday(y, m, wd, n)));
  return new Set([...fixed.filter(Boolean), ...floating]);
}

export function isBusinessDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  const wd = weekday(y, m, d);
  if (wd === 0 || wd === 6) return false;
  return !fedHolidays(y).has(day);
}

function nextDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// The day `count` business days after `from` (an instant), in Chicago. The send day itself never counts.
export function addBusinessDays(from, count) {
  let day = chicagoDay(from);
  let left = count;
  while (left > 0) {
    day = nextDay(day);
    if (isBusinessDay(day)) left -= 1;
  }
  return day;
}

/*
 * The start (midnight) of a Chicago day, as an instant. Autopay is scheduled for
 * the start of its day, so the daily billing cron (14:00 UTC, morning in Chicago)
 * charges it that day. Daylight saving is handled by asking what hour Chicago
 * shows at a first guess and correcting by the difference.
 */
export function chicagoDayStart(day) {
  const [y, m, d] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 6)); // CST is UTC-6
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: BILLING_TIME_ZONE, hour: "numeric", hourCycle: "h23", day: "numeric" }).formatToParts(guess);
  const shownHour = Number(parts.find((p) => p.type === "hour").value);
  const shownDay = Number(parts.find((p) => p.type === "day").value);
  // In CDT the guess shows 01:00 on the same day; in CST 00:00.
  const offsetHours = shownDay === d ? shownHour : shownHour - 24;
  return new Date(guess.getTime() - offsetHours * 60 * 60 * 1000);
}
