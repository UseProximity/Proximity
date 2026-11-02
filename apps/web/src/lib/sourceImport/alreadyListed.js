/*
 * Which of these buildings are already on Proximity, and whose.
 *
 * The picker shows the answer, and the batch creator asks again on the
 * server before it writes anything: what a browser says about ownership is
 * never trusted (a one-property paste sent none at all and made a duplicate
 * draft of another landlord's building; a crafted request could have named
 * someone else's listing as "yours").
 */
import supabase from "@/lib/supabase";
import { findExistingProperties } from "@/lib/listings/propertyName";
import { getOwnedListings } from "@/lib/listings/ownership";
import { resolveProximityLandlordId } from "@/lib/listings/placeholderOwner";

/*
 * Say which of these are already on Proximity, before the landlord works: the
 * landlord's own first ("On Proximity, yours"), then anyone's.
 */
export async function markAlreadyListed(properties, userId) {
  const pickable = properties.filter((p) => p.kind !== "group");
  if (!pickable.length) return properties;
  const owned = await getOwnedListings(userId);
  const [listed, mine] = await Promise.all([
    findExistingProperties(pickable),
    findExistingProperties(pickable, { ids: [...owned.keys()] }),
  ]);
  /*
   * Whose it is. Three answers, and the workspace treats each differently:
   *   you      your own record, or you hold a lease there: the read becomes
   *            proposed changes you accept on that tab
   *   none     listed by Proximity with no landlord behind it (an import or a
   *            review stub): ticking it makes it yours, then as above
   *   other    another landlord's: shown, not read, with a way to add your
   *            own units to it by hand
   */
  const hitIds = [...new Set([...listed.values(), ...mine.values()].map((h) => h.id))];
  const placeholderId = await resolveProximityLandlordId().catch(() => null);
  const { data: landlordRows } = hitIds.length ? await supabase.from("listing_landlords").select("listing_id, user_id").in("listing_id", hitIds) : { data: [] };
  const realOwners = new Set((landlordRows ?? []).filter((r) => r.user_id && r.user_id !== placeholderId).map((r) => r.listing_id));
  return properties.map((p) => {
    const own = mine.get(p);
    const hit = own ?? listed.get(p);
    return hit
      ? {
          ...p,
          alreadyListed: {
            id: hit.id,
            title: hit.title ?? null,
            address: hit.address ?? null,
            mine: own ? (owned.get(hit.id) === "lease" ? "lease" : "owner") : null,
            owner: own ? "you" : realOwners.has(hit.id) ? "other" : "none",
          },
        }
      : p;
  });
}
