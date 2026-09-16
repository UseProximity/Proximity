/*
 * How an offering's start date reads to a person.
 *
 * unit_leases.available_from is a plain date, and most of the ones we hold are
 * already in the past — a listing that became available in April and is still
 * up is available now. Printing "Apr 1, 2026" in August tells a renter nothing
 * except that the listing looks stale, so a date on or before today reads as
 * "Now" instead.
 */

// A date column is a calendar day, so it is compared as written rather than
// shifted into the viewer's timezone — otherwise "today" flips a day early or
// late depending on where the reader is.
export function isAvailableNow(availableFrom) {
  if (!availableFrom) return false;
  const day = String(availableFrom).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return day <= today;
}

/**
 * Label for an offering's availability.
 * Returns { text, now } — `now` lets the caller colour it.
 * A missing date is "—": unknown, not "available now".
 */
export function availabilityLabel(availableFrom) {
  if (!availableFrom) return { text: "—", now: false };
  if (isAvailableNow(availableFrom)) return { text: "Now", now: true };
  return {
    text: new Date(availableFrom).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }),
    now: false,
  };
}
