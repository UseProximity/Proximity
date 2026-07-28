// Wraps GET /api/listings, GET /api/listing/[listingId], GET /api/listings/popular.
// All three are fully public (no auth) per apps/web/src/app/api/listings/route.js,
// listing/[listingId]/route.js, and listings/popular/route.js. /api/listings takes
// no query params — filtering happens client-side, matching web's own contract.
export function createListingsResource(client) {
  return {
    getListings: () => client.request("/api/listings"),
    getListing: (listingId) => client.request(`/api/listing/${listingId}`),
    getPopularListings: () => client.request("/api/listings/popular"),
  };
}
