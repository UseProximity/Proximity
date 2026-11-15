import { canonStreet, metersBetween } from "@/lib/reviews/listingMatch";

/*
 * Review stubs that may be a building already listed under another address.
 *
 * An exact address match is automatic (lib/reviews/listingMatch.js). What is
 * left cannot be decided by a rule: a student reviews "311 DeBaliviere" and
 * the landlord lists the same complex as "299 DeBaliviere", or two numbers on
 * one street are one building to one landlord and two to another (Clocktower
 * at 6669 and 6675 Washington are separate listings). So nothing here merges
 * anything. It lists the pairs worth a person's look, strongest reason first.
 *
 * A stub is a property made by a review: no units, and no owner but the
 * Proximity placeholder.
 */

const SAME_STREET_METERS = 40;

const streetOf = (key) => String(key || "").split("|")[0];
// The street with its number taken off: "6669 washington" -> "washington".
const streetName = (key) => canonStreet(streetOf(key)).replace(/^[\d-]+\s+/, "");
const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const live = (rows) => (rows ?? []).filter((r) => !r.deleted_at);

async function allListings(supabase) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("listings")
      .select(
        `id, title, address, property_key, latitude, longitude, published_at,
         listing_units!listing_id(id, deleted_at),
         listing_landlords!listing_id(user_id),
         listing_reviews!listing_id(id, landlord_name, deleted_at)`
      )
      .is("deleted_at", null)
      .eq("review_sandbox", false)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

export async function findReviewDuplicateSuspects(supabase, placeholderId) {
  const listings = await allListings(supabase);
  const stubs = [];
  const listed = [];
  for (const l of listings) {
    const hasUnits = live(l.listing_units).length > 0;
    const reviews = live(l.listing_reviews);
    const realOwner = (l.listing_landlords ?? []).some((o) => o.user_id !== placeholderId);
    if (hasUnits) listed.push(l);
    else if (reviews.length && !realOwner) stubs.push({ ...l, reviews });
  }

  const suspects = [];
  for (const stub of stubs) {
    const named = stub.reviews.map((r) => words(r.landlord_name)).filter(Boolean);
    for (const l of listed) {
      const hasPoint = [stub.latitude, stub.longitude, l.latitude, l.longitude].every((v) => v != null);
      const meters = hasPoint
        ? Math.round(metersBetween(Number(stub.latitude), Number(stub.longitude), Number(l.latitude), Number(l.longitude)))
        : null;

      let reason = null;
      if (stub.property_key && stub.property_key === l.property_key) {
        reason = "same address";
      } else {
        // The review names the building ("Local on Delmar") and a listing is called that.
        // One word is not a name: "Lofts" in a review is not Grove Lofts across town.
        const title = words(l.title);
        const isName = (s) => s.length >= 8 && s.includes(" ") && !/^\d/.test(s);
        if (isName(title) && named.some((n) => n === title || n.includes(title) || (isName(n) && title.includes(n)))) {
          reason = "review names this building";
        } else if (
          meters != null &&
          meters <= SAME_STREET_METERS &&
          streetName(stub.property_key) &&
          streetName(stub.property_key) === streetName(l.property_key)
        ) {
          reason = "same street, next door";
        }
      }
      if (!reason) continue;

      suspects.push({
        key: `${stub.id}:${l.id}`,
        reason,
        meters,
        stub: {
          id: stub.id,
          address: stub.address,
          reviewCount: stub.reviews.length,
          landlordNames: [...new Set(stub.reviews.map((r) => (r.landlord_name || "").trim()).filter(Boolean))],
        },
        listing: { id: l.id, title: l.title ?? null, address: l.address, live: !!l.published_at },
      });
    }
  }

  const rank = { "same address": 0, "review names this building": 1, "same street, next door": 2 };
  return suspects.sort((a, b) => rank[a.reason] - rank[b.reason] || (a.meters ?? 1e9) - (b.meters ?? 1e9));
}
