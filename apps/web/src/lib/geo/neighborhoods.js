/*
 * Canonical neighborhood table for the WashU market. Listings only carry
 * coordinates (zipcode/city are unpopulated), so neighborhood membership is
 * nearest-centroid-within-radius. Coarse but validated against the live
 * listing set (2026-08-10): every area below contains 5+ listings.
 *
 * Consumers:
 *  - /washu/[slug] neighborhood landing pages (neighborhoodOfListing)
 *  - matchmaking's neighborhoodScore (imports CENTROIDS + haversineKm via
 *    lib/matchmaking/listingFilter.js so student-facing behavior stays in
 *    one place)
 *
 * Clayton's centroid was corrected from 38.6426,-90.3237 (which sat on the
 * University City/Forsyth edge and mislabeled UCity listings as Clayton) to
 * downtown Clayton, verified against actual listing addresses (Hanley,
 * Lindell) before committing.
 */

export const NEIGHBORHOOD_RADIUS_KM = 1.3;

export const NEIGHBORHOODS = [
  {
    key: "the-loop",
    matchmakingKey: "The Loop",
    displayName: "The Delmar Loop",
    slug: "delmar-loop-apartments",
    lat: 38.6555,
    lng: -90.303,
  },
  {
    key: "central-west-end",
    matchmakingKey: "Central West End",
    displayName: "Central West End",
    slug: "central-west-end-apartments",
    lat: 38.644,
    lng: -90.263,
  },
  {
    // Clayton is also a municipality; match the city position in the address
    // (comma-anchored so "Clayton Rd" in St. Louis addresses cannot match).
    key: "clayton",
    matchmakingKey: "Clayton",
    displayName: "Clayton",
    slug: "clayton-apartments",
    addressMatch: /,\s*clayton\b/i,
    lat: 38.647,
    lng: -90.332,
  },
  {
    key: "demun",
    matchmakingKey: "DeMun",
    displayName: "DeMun",
    slug: "demun-apartments",
    lat: 38.633,
    lng: -90.3095,
  },
  {
    // Matchmaking-only: DeBaliviere Place overlaps Skinker-DeBaliviere almost
    // entirely in student terms, and its centroid sits ~250m from the SDB one.
    // If this entry were page-assignable, nearest-wins would silently split
    // that dense cluster into a neighborhood with no landing page.
    key: "debaliviere",
    matchmakingKey: "DeBaliviere",
    pageAssignable: false,
    displayName: "DeBaliviere Place",
    slug: null,
    lat: 38.65,
    lng: -90.293,
  },
  {
    // University City is a municipality, not a district: The Loop and parts
    // of the student blocks sit INSIDE it, so centroid-nearest assignment
    // starves it. addressMatch pulls in every listing whose address names the
    // city (overlap with the Loop page is semantically correct).
    key: "university-city",
    matchmakingKey: null,
    displayName: "University City",
    slug: "university-city-apartments",
    addressMatch: /,\s*university\s+city\b/i,
    lat: 38.6606,
    lng: -90.33,
  },
  {
    key: "skinker-debaliviere",
    matchmakingKey: null,
    displayName: "Skinker-DeBaliviere",
    slug: "skinker-debaliviere-apartments",
    lat: 38.6479,
    lng: -90.2925,
  },
];

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Nearest neighborhood whose centroid is within the radius, else null.
// Note DeBaliviere and Skinker-DeBaliviere overlap heavily; nearest-wins keeps
// each listing in exactly one area.
export function neighborhoodOfListing(listing) {
  const lat = Number(listing?.latitude);
  const lng = Number(listing?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = null;
  let bestDist = Infinity;
  for (const n of NEIGHBORHOODS) {
    if (n.pageAssignable === false) continue;
    const d = haversineKm(lat, lng, n.lat, n.lng);
    if (d <= NEIGHBORHOOD_RADIUS_KM && d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

// Matchmaking-facing view: { "The Loop": {lat, lng}, ... } for the areas the
// matchmaking question script offers. Preserves the legacy key names.
export const MATCHMAKING_CENTROIDS = Object.fromEntries(
  NEIGHBORHOODS.filter((n) => n.matchmakingKey).map((n) => [
    n.matchmakingKey,
    { lat: n.lat, lng: n.lng },
  ])
);
