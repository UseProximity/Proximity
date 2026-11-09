/*
 * When the monthly billing run happens. It runs on the first Monday of each
 * month in America/Chicago time.
 *
 * Vercel crons are UTC and know nothing about months or DST, so the cron fires
 * every day and the run calls isBillingDay(): on any day that is not the
 * first one of its month it exits without touching anything.
 */
import { BILLING_TIME_ZONE } from "./constants.js";

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: BILLING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// The calendar date in Chicago at this instant.
export function chicagoDate(now = new Date()) {
  const parts = Object.fromEntries(partsFormat.formatToParts(now).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

// Day of the month (1 to 7) of the first Monday. Pure calendar arithmetic, so
// no time zone is involved: 0 = Sunday ... 6 = Saturday.
export function firstMondayOfMonth(year, month) {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((1 - dow + 7) % 7);
}

export function isBillingDay(now = new Date()) {
  const { year, month, day } = chicagoDate(now);
  return day === firstMondayOfMonth(year, month);
}

// The next billing day on or after today (Chicago), as YYYY-MM-DD.
export function nextBillingDay(now = new Date()) {
  const today = chicagoDate(now);
  let { year, month } = today;
  if (today.day > firstMondayOfMonth(year, month)) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const day = firstMondayOfMonth(year, month);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The invoice's billing period: the first day of the Chicago month, as
// YYYY-MM-01. With the landlord it is the idempotency key of the run.
export function billingPeriodFor(now = new Date()) {
  const { year, month } = chicagoDate(now);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
