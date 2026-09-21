/*
 * Bedroom and bathroom counts.
 *
 * These are physical room counts, so they can never be negative — but every
 * form that collects them is a plain <input type="number">, and a spinner
 * arrow on an empty field walks straight past zero. Four live listings were
 * posted with -2 bed / -1 bath that way (Aug 31 2026) before anything caught
 * it, so the guard now lives in one place and is applied at every layer:
 * the inputs clamp, the API routes reject, and listing_units carries a CHECK.
 */

// What a form field should hold after the user types or clicks. Empty stays
// empty (the "not answered yet" state every unit form checks for); anything
// below zero is pulled up to zero rather than rejected, so the spinner simply
// stops at 0 instead of the field appearing to ignore the click.
export function clampCount(value) {
  if (value === "" || value == null) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n < 0 ? 0 : n;
}

// Server-side gate: a count is only acceptable if it is a real, non-negative
// number. Callers turn a false into a 400.
export function isValidCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

/*
 * Bedrooms are a count of rooms, so unlike bathrooms they are always whole.
 * listing_units.bedrooms is an integer column, which means a 2.5 reaches
 * Postgres as "invalid input syntax for type integer" and surfaces as a generic
 * save failure. A landlord hit exactly that three times at 7244 Forsyth on
 * Sep 16 2026, leaving three empty property rows behind. Callers turn a false
 * into a 400 that names the field.
 */
export function isWholeCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n);
}

// The bedrooms counterpart to clampCount: also drops a fractional entry to the
// whole number below it, so typing "2.5" settles at 2 rather than failing on
// publish. Empty stays empty.
export function clampWholeCount(value) {
  const clamped = clampCount(value);
  if (clamped === "") return "";
  return Math.floor(Number(clamped));
}
