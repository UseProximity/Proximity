/*
 * Calendar days: a move-in date, a special's valid-until. One rule for all of them.
 *
 * A calendar day names a day, not a moment. Read as a moment, "2027-01-01" is
 * midnight UTC, which is the evening before in St. Louis, so it showed a day
 * early wherever it was formatted in local time (a Jan 1 move-in read
 * "Dec 31"). These helpers keep the day the value names.
 *
 * Safe in the browser and on the server (no imports).
 */

const LEADING_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
// A plain date, or the same day stamped midnight UTC, which is how a date
// column or a date-only JS Date serializes.
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?(?:Z|[+-]00:?00))?$/;

/* The "YYYY-MM-DD" a string starts with, or null when it does not start with a real date. */
export function dayOf(value) {
  if (typeof value !== "string") return null;
  const m = LEADING_DAY.exec(value.trim());
  if (!m) return null;
  const day = m[0];
  const t = new Date(`${day}T00:00:00Z`);
  // "2027-02-31" parses by rolling over into March: not a real date.
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === day ? day : null;
}

/* Is this a calendar day (not a moment with a real time)? */
export function isCalendarDay(value) {
  return typeof value === "string" && DAY_ONLY.test(value.trim()) && dayOf(value) !== null;
}

/*
 * "Jan 1, 2027" for a value known to be a calendar day (a date column), or
 * null when it is not a date. Pass { year: false } for "Jan 1".
 */
export function dayText(value, { year = true } = {}) {
  const day = dayOf(typeof value === "string" ? value : value == null ? "" : String(value));
  if (!day) return null;
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC",
  });
}
