/*
 * Is this unit something a renter can actually take?
 *
 * Availability used to be stored on `listing_units.available` — a checkbox a
 * landlord ticked on one screen, reported by a badge on another, with nothing
 * keeping the two honest. It drifted. 721 Limit sat invisible to students for
 * three weeks while its owner's dashboard showed a green "Available", because
 * the unit form's checkbox had been unticked once at save time and no surface
 * the landlord could see ever mentioned it again.
 *
 * So availability is no longer a stored fact. It is read off the offerings —
 * the thing a renter actually signs:
 *
 *   one or more LIVE offerings   -> AVAILABLE. Someone is letting it right now.
 *   offerings, all withdrawn     -> UNAVAILABLE. It was on the market; it isn't.
 *   no offerings at all          -> AVAILABLE (unknown).
 *
 * That last clause is load-bearing, not a nicety. Unpriced room data — a
 * scraped building nobody has published terms for — is a large share of the
 * marketplace, and `filterListings` is built around keeping it visible and
 * sinking it rather than dropping it. Reading "no offering" as "gone" would
 * have hidden 8 live properties the day this shipped. Unknown is not gone.
 *
 * One definition, imported everywhere, so browse, the detail panel, the
 * sitemap, the landlord dashboard, admin and Proxy cannot disagree again.
 */

/** A live offering: it exists and its owner has not withdrawn it. */
export const isLiveLease = (lease) => !!lease?.is_active && !lease?.unavailable;

/** Every offering on this unit a renter could actually take. */
export function liveLeasesOf(unit) {
  return (unit?.unit_leases ?? []).filter(isLiveLease);
}

export function unitIsAvailable(unit) {
  const leases = unit?.unit_leases ?? [];
  if (!leases.length) return true; // unknown, not gone — see above
  return leases.some(isLiveLease);
}

/**
 * Listing-level visibility.
 *
 * The owner's own `listings.unavailable` flag still hides a whole property
 * outright — that one is a deliberate, single-click act on a screen that shows
 * its own state, so it never drifted the way the unit flag did.
 *
 * Below that, a listing is hidden when it HAS units and not one is available.
 * A listing carrying no units at all is never flipped by this: that is missing
 * data, not a leased-out building.
 */
export function listingIsUnavailable(row) {
  if (row?.unavailable) return true;
  const units = row?.listing_units ?? [];
  return units.length > 0 && units.every((u) => !unitIsAvailable(u));
}
