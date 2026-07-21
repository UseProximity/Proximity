/*
 * PMS connector contract + normalized shapes.
 *
 * Every connector (buildium.js, appfolio.js, doorloop.js, …) implements:
 *
 *   verifyConnection(connectionId) -> { ok, error?, accountLabel? }
 *   fetchSnapshot(connectionId)    -> { properties: PmsProperty[], errors: string[] }
 *
 * fetchSnapshot must NOT throw — it returns the full current picture of the
 * account (the PMS is the source of truth; the sync reconciles against it) and
 * collects partial failures in `errors`. When a whole snapshot cannot be
 * trusted (auth failure, network down), return { properties: [], errors: [..] }
 * and the sync will refuse to reconcile (a broken pull must never delist a
 * portfolio — that's also what the ±20% swing guard protects against).
 *
 * Normalized shapes (plain objects):
 *
 *   PmsProperty { externalPropertyId: string, name: string|null,
 *                 address: string|null, city, state, zip: string|null,
 *                 units: PmsUnit[] }
 *   PmsUnit     { externalUnitId: string, label: string|null,
 *                 available: boolean|null,   // null = unknown -> sync takes NO action
 *                 rent: number|null, bedrooms: number|null, bathrooms: number|null,
 *                 area: number|null, availableFrom: string|null (YYYY-MM-DD),
 *                 beds: PmsBed[]|null,       // by-the-bed student housing only
 *                 rawStatus: string|null }
 *   PmsBed      { externalBedId: string, label: string|null,
 *                 available: boolean|null, rent: number|null, availableFrom: string|null }
 */

// Buildium (and some others) report bedrooms/bathrooms as words.
const BEDROOM_WORDS = {
  studio: 0, oneBed: 1, twoBed: 2, threeBed: 3, fourBed: 4,
  fiveBed: 5, sixBed: 6, sevenBed: 7, eightBed: 8, nineBedPlus: 9,
};
const BATHROOM_WORDS = {
  oneBath: 1, onePointFiveBath: 1.5, twoBath: 2, twoPointFiveBath: 2.5,
  threeBath: 3, threePointFiveBath: 3.5, fourBath: 4, fourPointFiveBath: 4.5,
  fiveBath: 5, fivePlusBath: 5,
};

function wordLookup(map, value) {
  if (value == null) return null;
  const key = String(value).replace(/[^a-z0-9]/gi, "");
  const hit = Object.keys(map).find((k) => k.toLowerCase() === key.toLowerCase());
  return hit != null ? map[hit] : null;
}

// Coerce a PMS bedroom value ("TwoBed", "2", 2) to an integer or null.
export function toBedrooms(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.trunc(n);
  return wordLookup(BEDROOM_WORDS, value);
}

// Coerce a PMS bathroom value ("OnePointFiveBath", "1.5", 1.5) to a number or null.
export function toBathrooms(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return wordLookup(BATHROOM_WORDS, value);
}

// Coerce to a positive finite number or null (rents, areas).
export function toMoney(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Coerce a date-ish value to "YYYY-MM-DD" or null.
export function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Compose a one-line address from parts, skipping blanks.
export function joinAddress(...parts) {
  const s = parts.filter((p) => p && String(p).trim()).join(", ");
  return s || null;
}
