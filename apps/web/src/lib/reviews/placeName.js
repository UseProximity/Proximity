/*
 * What to call the place a review is about, in copy addressed to the reviewer.
 *
 * Listings carry an optional title and a full postal address, and 43% of them
 * have no title at all, so neither field alone is enough. The address is the
 * reliable one but reads badly in a sentence ("Your review of 6038 Westminster
 * Place, St. Louis, Missouri 63112, United States is live"), so it is trimmed to
 * the street line, which is how students name a house anyway.
 *
 * Client-safe; no server imports.
 */

/** Street line of a postal address: everything before the first comma. */
export function streetLine(address) {
  return String(address || "").split(",")[0].trim();
}

/** Display name for a listing a review is attached to. */
export function listingPlaceName(listing) {
  const title = String(listing?.title || "").trim();
  if (title) return title;
  return streetLine(listing?.address) || "your place";
}
