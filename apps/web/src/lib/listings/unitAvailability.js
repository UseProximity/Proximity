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
 * the thing a renter actually signs. A unit is available when at least one of
 * its offerings is live (active, and not withdrawn by its owner), and not
 * otherwise. No offering means nothing to take, which means not on the market.
 *
 * A NOTE ON "NO OFFERINGS AT ALL", because it is the whole risk here:
 *
 * This rule reads an offering-less unit as UNAVAILABLE. That is only safe
 * because the units that had no offering were fixed first rather than written
 * off. Eight live properties — Kingsland Courtyard, Five-Nine, University
 * Square, four Roberts Realty addresses and 520 Westgate — carried their leases
 * only in the retired `listing_leases` table: the 2026-03/04 bulk imports wrote
 * unit rows and legacy lease rows and never created the `unit_leases` offering.
 * They were never empty listings; the app was reading the wrong table. The
 * backfill in 202609020002 gives each of them a real offering, after which
 * exactly zero live listings depend on the lenient reading.
 *
 * If you are about to relax this back to "no offerings means available", find
 * out what that is covering for first. It masked a data bug for five months.
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
  return (unit?.unit_leases ?? []).some(isLiveLease);
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
 * data about the building itself — a different bug with a different fix, and
 * 23 live listings are in that state today.
 */
export function listingIsUnavailable(row) {
  if (row?.unavailable) return true;
  const units = row?.listing_units ?? [];
  return units.length > 0 && units.every((u) => !unitIsAvailable(u));
}
