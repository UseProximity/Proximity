// Wraps POST /api/contactLandlord (apps/web/src/app/api/contactLandlord/route.js).
// No server-side auth requirement for a plain inquiry — called anonymously per
// the plan's decision to match the server's actual public behavior. listingId
// is optional; the server only checks a session (for the 21+ gate) when it's
// present and a listing is age-restricted.
export function createContactLandlordResource(client) {
  return {
    contactLandlord: ({
      firstName,
      lastName,
      email,
      phone,
      message,
      listingId,
      landlordEmail,
      landlordName,
      listingAddress,
    }) =>
      client.request("/api/contactLandlord", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          phone,
          message,
          listingId,
          landlordEmail,
          landlordName,
          listingAddress,
        }),
      }),
  };
}
