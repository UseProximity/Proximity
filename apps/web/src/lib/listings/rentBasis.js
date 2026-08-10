/*
 * Shared rent-basis heuristic. unit_leases.rent stores two conventions with no
 * flag: whole-unit rent for most listings, per-person rent for room-shares and
 * some sublets. The MIN_PLAUSIBLE_PER_PERSON split test below is the single
 * source of truth for telling them apart; it was validated against the live
 * data (every multi-bed lease divides to under $400/bed or over $480/bed,
 * with one exception). Keep the constant and logic here only.
 *
 * Extracted from lib/matchmaking/listingFilter.js so server-rendered pages can
 * use it without importing that module's load-time side effects (Anthropic
 * client + a readFileSync that throws when the skill file is missing).
 */

export const MIN_PLAUSIBLE_PER_PERSON = 450;

// Per-person and whole-unit rent for one lease, plus how we decided.
// A one-bedroom (or unsized) unit is one person's rent under either convention.
// A room-share is a single room by definition, so its price is already per
// person whatever the unit's bedroom count says.
export function leaseRentBasis(lease, isRoomShare) {
  const rent = Number(lease?.rent);
  if (!Number.isFinite(rent) || rent <= 0) return null;
  const beds = Number(lease?.bedrooms) || 0;
  const asPerson = {
    perPerson: rent,
    unitRent: rent * Math.max(beds, 1),
    beds,
    basis: "person",
  };
  if (isRoomShare || beds <= 1) return { ...asPerson, unitRent: rent };
  const split = rent / beds;
  return split >= MIN_PLAUSIBLE_PER_PERSON
    ? { perPerson: split, unitRent: rent, beds, basis: "unit" }
    : asPerson;
}

// Cheapest per-person rent across a BUILT listing's available unit types
// (the fetchListings()/buildListing() shape, where each unitTypes entry
// carries the unit's first active lease rent). null when nothing is priced.
export function minPerPersonRent(listing) {
  let best = null;
  for (const u of listing?.unitTypes ?? []) {
    if (u.available === false) continue;
    const basis = leaseRentBasis(u, false);
    if (basis && (best == null || basis.perPerson < best)) {
      best = basis.perPerson;
    }
  }
  return best;
}
