/*
 * Ask whether we already hold a property at an address, and shape the answer the
 * way the Add Listing flow keeps it (`place`).
 *
 * Shared by the address step, which calls it when a suggestion is chosen, and by
 * the restore of a saved draft, which has only the address and must rebuild the
 * lookup behind it.
 *
 * A failed lookup must not block listing: it comes back as a new property, and
 * the address-key check at publish catches a genuine collision.
 */
export async function lookupPlace({ address, longitude = null, latitude = null }) {
  let property = null;
  try {
    const res = await fetch(`/api/properties/lookup?address=${encodeURIComponent(address)}`);
    const data = await res.json();
    property = data.property ?? null;
  } catch {
    // Treated as a new property, see above.
  }
  return { address, longitude, latitude, property, units: property?.units ?? [] };
}
