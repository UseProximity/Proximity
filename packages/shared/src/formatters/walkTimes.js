import { NON_CAMPUS_WALK_PLACES } from "../constants/places.js";

// Returns the minimum walk time (in minutes) to any WashU place that counts
// as "campus" (excludes the grocery store and Med Campus), or null if no
// usable data exists. Mirrors the inline calculation in web's ListingCard
// (apps/web/src/components/listings/MapPopupCard.js) and BrowseContent's
// distance filter — factored into a shared function since mobile needs it
// in two places (the listing card now, the browse distance filter later).
export function getCampusWalkMinutes(placeWalkMinutes) {
  if (!placeWalkMinutes || typeof placeWalkMinutes !== "object") return null;
  const values = Object.entries(placeWalkMinutes)
    .filter(([name]) => !NON_CAMPUS_WALK_PLACES.includes(name))
    .map(([, minutes]) => minutes)
    .filter(Number.isFinite);
  return values.length > 0 ? Math.min(...values) : null;
}
