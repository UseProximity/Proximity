// Wraps PATCH/DELETE /api/landlord/listings/[listingId] (apps/web/src/app/api/landlord/listings/[listingId]/route.js)
// — requires a bearer token for a landlord/super (or the listing's owner), enforced
// server-side via getRequestUser + listing_landlords ownership check. Fetching a
// landlord's own listings doesn't need a resource here — apiClient.user.getUser()
// already returns them at `.listings` (apps/web/src/app/api/getUser/route.js).
export function createLandlordResource(client) {
  return {
    updateListing: (listingId, patch) =>
      client.request(`/api/landlord/listings/${listingId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    deleteListing: (listingId) =>
      client.request(`/api/landlord/listings/${listingId}`, {
        method: "DELETE",
      }),
  };
}
