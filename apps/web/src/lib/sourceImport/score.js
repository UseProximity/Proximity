/*
 * The sync's confidence scores (PRD "Sync confidence ledger", Wyatt
 * 2026-11-19 to 11-24). Every value on a listing is backed by claims: who
 * stated it, where, and how sure we are. A claim's score, 0 to 1:
 *
 *   score = trust x read quality x right thing x freshness
 *
 * A website change applies when its score clears the bar for its action AND
 * beats the current value's score by MARGIN. Nothing is held for a person: a
 * change that misses is scored again on the next read.
 *
 * Landlord rules (2026-11-24):
 *   - A landlord edit never loses to a website value that has not moved since
 *     the edit. Only a website value that moved after the edit can challenge
 *     it, and the edit's fading freshness sets how soon.
 *   - A blank rent the landlord chose ("Contact for pricing") never fades. The
 *     website price is kept as a hidden price instead (lib/listings/hiddenRents.js).
 *   - Guesses (lease lengths from general text, dates a page never states)
 *     only fill an empty field.
 *   - A starting-at price can fill an empty rent (on the 12 month lease) or
 *     replace another starting-at price, never an exact one.
 *
 * Pure: no database, no network.
 */

export const TRUST = {
  landlord: 0.95,
  feed: 0.9, // a leasing portal or platform feed, or a unit's own page
  structured: 0.85, // structured data on the page (JSON-LD, embedded JSON)
  recipe: 0.8,
  portalSite: 0.7, // Zillow, Apartments.com
  pattern: 0.6, // the pattern parser
  haiku: 0.6, // Haiku, at import only
};

export const MARGIN = 0.15;

/* The bar each action must clear. */
export const BARS = {
  fill: 0.5, // filling an empty field, photos
  add: 0.65, // a new lease or unit
  rent: 0.75,
  description: 0.75,
  withdraw: 0.8, // and seen gone on 2 reads in a row
  specs: 0.85, // beds, baths, size, name
};
export const WITHDRAW_READS = 2;

/* Within this of the bar (either side) a decision is borderline: listed for admins. */
export const BORDERLINE = 0.05;

/* Days until a landlord edit is at half strength. */
export const HALF_STRENGTH_DAYS = {
  availability: 14,
  availableFrom: 30,
  rent: 45,
  leaseTermMonths: 90,
  description: 182,
  specs: 730,
};

/* Read quality cap on a starting-at price or a rent with no stated basis. */
export const ROUGH_CAP = 0.5;

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/* Which half-strength row a field uses. */
export function fieldGroup(field) {
  if (["bedrooms", "bathrooms", "area", "name"].includes(field)) return "specs";
  if (field === "unavailable" || field === "availability") return "availability";
  if (field === "rentIsPerPerson") return "rent";
  return HALF_STRENGTH_DAYS[field] ? field : "rent";
}

/* The bar for one change. */
export function barFor({ action, field }) {
  if (action === "withdraw") return BARS.withdraw;
  if (action === "add") return BARS.add;
  if (action === "fill" || action === "photos") return BARS.fill;
  if (field === "description") return BARS.description;
  if (fieldGroup(field) === "specs") return BARS.specs;
  return BARS.rent;
}

/*
 * A landlord edit's freshness: slow at first, then faster, zero at 1.41 x the
 * half-strength day (decided 2026-11-19).
 *   freshness = 1 - (days / (1.41 x half-strength))^2
 */
export function landlordFreshness(days, field) {
  const h = HALF_STRENGTH_DAYS[fieldGroup(field)];
  const d = Math.max(0, Number(days) || 0);
  return clamp01(1 - (d / (1.41 * h)) ** 2);
}

/*
 * A website claim's freshness.
 *   movedSinceLandlord  the website value changed after the landlord's last edit
 *   landlordEdited      the landlord has edited this field
 *   missedReads         reads in a row the claim was not seen
 */
export function websiteFreshness({ landlordEdited = false, movedSinceLandlord = false, missedReads = 0 }) {
  if (missedReads >= 2) return 0;
  if (landlordEdited && !movedSinceLandlord) return 0;
  return 1;
}

/* One claim's score. Every part 0 to 1. */
export function claimScore({ trust, readQuality = 1, rightThing = 1, freshness = 1 }) {
  return clamp01(clamp01(trust) * clamp01(readQuality) * clamp01(rightThing) * clamp01(freshness));
}

/*
 * The current value's score: a landlord value fades, a landlord-chosen blank
 * rent never does, a value the sync wrote keeps the score it was written at.
 *   current  { by: "landlord" | "sync" | null, daysSinceEdit, score, blankByChoice }
 */
export function currentScore(current, field) {
  if (!current || current.empty) return 0;
  if (current.by === "landlord") {
    if (current.blankByChoice && fieldGroup(field) === "rent") return TRUST.landlord;
    return claimScore({ trust: TRUST.landlord, freshness: landlordFreshness(current.daysSinceEdit, field) });
  }
  return clamp01(current.score ?? TRUST.pattern);
}

/*
 * Decide one change.
 *   change   { action, field, claim: { trust, readQuality, rightThing, freshness },
 *              inferred, rentType: "exact" | "starting_at" | "range",
 *              readsInRow }
 *   current  as currentScore, plus { rentType, empty }
 * Returns { apply, score, current, need, bar, borderline, reason, hidden }.
 *   need      what the score had to reach: max(bar, current + MARGIN)
 *   hidden    true when the value goes to the hidden price store instead
 */
export function decide(change, current = null) {
  const field = change.field;
  const bar = barFor(change);
  const score = claimScore(change.claim ?? {});
  const cur = currentScore(current, field);
  const need = Math.max(bar, current?.empty ? 0 : cur + MARGIN);
  const out = { score, current: cur, need, bar, hidden: false };
  const rentField = fieldGroup(field) === "rent" && field !== "rentIsPerPerson";
  const filling = !current || current.empty;

  // A blank rent the landlord chose stays blank; the price is kept hidden.
  if (rentField && current?.by === "landlord" && current.blankByChoice) {
    return { ...out, apply: false, hidden: true, borderline: false, reason: "the landlord chose to show no price; the website price is kept hidden" };
  }
  // A guess only fills an empty field.
  if (change.inferred && !filling) {
    return { ...out, apply: false, borderline: false, reason: "inferred from general text, so it only fills an empty field" };
  }
  // A starting-at price never replaces an exact one.
  if (rentField && change.rentType && change.rentType !== "exact" && !filling && current?.rentType === "exact") {
    return { ...out, apply: false, borderline: false, reason: "the website shows a starting-at price, which never replaces an exact one" };
  }
  if (change.action === "withdraw" && (change.readsInRow ?? 1) < WITHDRAW_READS) {
    return { ...out, apply: false, borderline: Math.abs(score - need) <= BORDERLINE, reason: `seen gone on ${change.readsInRow ?? 1} read; it takes ${WITHDRAW_READS} in a row` };
  }
  const apply = score >= need;
  const borderline = Math.abs(score - need) <= BORDERLINE;
  let reason = null;
  if (!apply) {
    if (score < bar) reason = `score ${fmt(score)} is under the bar of ${fmt(bar)}${weakest(change.claim)}`;
    else reason = `score ${fmt(score)} does not beat the current value's ${fmt(cur)} by ${fmt(MARGIN)}`;
  }
  return { ...out, apply, borderline, reason };
}

const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);

/* The part that pulled a claim down, in words. */
function weakest(claim = {}) {
  const parts = [
    ["read quality", claim.readQuality ?? 1],
    ["right-thing check", claim.rightThing ?? 1],
    ["freshness", claim.freshness ?? 1],
  ].sort((a, b) => a[1] - b[1]);
  return parts[0][1] < 1 ? ` (lowest part: ${parts[0][0]} at ${fmt(parts[0][1])})` : "";
}

/*
 * The lease a starting-at price lands on when digging deeper found no price
 * per lease length (Wyatt, 2026-11-24): the 12 month lease, else the longest
 * length offered, else 12.
 */
export function startingAtTerm(terms) {
  const t = (terms ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!t.length || t.includes(12)) return 12;
  return Math.max(...t);
}
