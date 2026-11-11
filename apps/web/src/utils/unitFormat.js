/*
 * Whether a unit name is an apartment ("Apt 201", "Unit 5548", "305") or a
 * floor plan ("The Aspen", "2 Bed 2 Bath", "Studio A"), so the source sync
 * can tell when a website lists units in a different shape from the listing
 * (Wyatt, 2026-11-11: a listing built from floor plans should not gain an
 * "Apt 201" on its own).
 *
 * Deliberately cautious. Codes like "A1", "Unit B4" or "CMLH-3TD" are floor
 * plan codes at one building and apartment numbers at the next, so they are
 * "unknown", and an unknown never conflicts with anything. "Whole property"
 * and unnamed units are unknown too: a listing made of those has no format
 * yet, and the first real units a website shows set it.
 *
 * Pure on purpose. unitFormat.test.js covers it.
 */

const LAYOUT_WORDS = /\b(studios?|lofts?|bed(room)?s?|br|bd|bath(room)?s?|ba|town ?(house|home)s?|penthouse|duplex|floor ?plan|plan|suite type|type [a-z0-9]+)\b|\d\s*(br|bd|ba|bed|bath)\b/i;
const PLACEHOLDER = /^(whole|entire)\s+(property|house|home|unit|apartment|building)$|^(apartment|unit|house|home|floor\s*\d+|\d+(st|nd|rd|th)\s*(fl|flr|floor))$/i;
// "Apt 201", "Apt 1W", "Apt B", "Apartment 4B", "#3", "Suite 210", "No. 12".
// The prefix needs a separator and a door code with a digit, or a single
// letter, after it: without one, "Nova", "Noble", "Stella", "Suites" and
// "Aptos" read as apartments (PR #418 review).
const APT_PREFIX = /^(?:(?:apt|apartment|suite|ste|no)[.\s#]+(?:[a-z]?\d{1,5}[a-z]{0,2}|[a-z])|#\s*[a-z]?\d{1,5}[a-z]{0,2})$/i;
// "Unit 5548", "Unit 201", "Unit 201A": three or more digits read as a door number.
const UNIT_NUMBER = /^unit\s*#?\s*\d{3,5}[a-z]?$/i;
// A bare door number: "201", "5548", "305B".
const BARE_NUMBER = /^\d{3,5}[a-z]?$/i;

export function unitFormat(name) {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!n || PLACEHOLDER.test(n)) return null;
  if (APT_PREFIX.test(n) || UNIT_NUMBER.test(n) || BARE_NUMBER.test(n)) return "apartment";
  if (/^(apt\.?|unit|suite|ste\.?|no\.?|#)\b/i.test(n)) return null;
  if (LAYOUT_WORDS.test(n)) return "plan";
  // Plain words, no digits: a floor plan's name ("The Aspen", "Market Premium").
  if (/^[a-z][a-z .'&-]*$/i.test(n) && n.length >= 3) return "plan";
  return null;
}

/* The listing's format: the one known format its units share, else null. */
export function listingUnitFormat(names) {
  const seen = new Set((names ?? []).map(unitFormat).filter(Boolean));
  return seen.size === 1 ? [...seen][0] : null;
}

/* A new unit contradicts the listing only when both formats are known and differ. */
export function formatConflict(listingFormat, name) {
  const f = unitFormat(name);
  return !!(listingFormat && f && f !== listingFormat);
}
