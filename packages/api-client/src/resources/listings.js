// Wraps GET /api/listings, GET /api/listing/[listingId], GET /api/listings/popular
// (all three fully public, no auth, per apps/web/src/app/api/listings/route.js,
// listing/[listingId]/route.js, and listings/popular/route.js — /api/listings takes
// no query params, filtering happens client-side, matching web's own contract),
// plus POST /api/addListing (createListing — requires a bearer token and a
// landlord/student/super role, per addListing/route.js's getRequestUser check).
// createListing forwards payload as-is; the caller (Add Listing's wizard) shapes
// it to match AddListingWizard.js's own submit body.
export function createListingsResource(client) {
  return {
    getListings: () => client.request("/api/listings"),
    getListing: (listingId) => client.request(`/api/listing/${listingId}`),
    getPopularListings: () => client.request("/api/listings/popular"),
    // Review safety (both need a bearer token). The server resolves the review's
    // author itself, so anonymous reviews can be reported but never blocked.
    reportReview: (reviewId) =>
      client.request("/api/reviewReport", {
        method: "POST",
        body: JSON.stringify({ reviewId }),
      }),
    blockReviewAuthor: (reviewId) =>
      client.request("/api/userBlock", {
        method: "POST",
        body: JSON.stringify({ reviewId }),
      }),
    createListing: (payload) =>
      client.request("/api/addListing", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  };
}
