import supabase from "@/lib/supabase";

/*
 * Who owns what, now that a property can carry offerings from several landlords.
 *
 * There are two DIFFERENT kinds of ownership and conflating them is a privilege
 * escalation, not a convenience:
 *
 *   PROPERTY ownership (listing_landlords)
 *     Control of the shared listing row — address, coordinates, amenities, and
 *     the unit set. `PATCH /api/landlord/listings/[id]` replaces every unit on
 *     the listing and `DELETE` removes it outright, so this must stay limited to
 *     whoever actually owns the building's record.
 *
 *   LEASE ownership (unit_leases.owner_id)
 *     Control of one offering on one unit. A landlord who attaches a lease to
 *     someone else's property is one of these: the offering is theirs, the
 *     building's record is not.
 *
 * A lease owner therefore SEES the property on their dashboard and may edit
 * their own lease, but must never be able to edit or delete the property or
 * touch another landlord's units. Writing a listing_landlords row for them —
 * the obvious-looking fix — would hand them exactly those powers.
 */

/**
 * Every listing the user has something at, tagged with which kind of ownership
 * it is. Property ownership wins when a user holds both, because it is strictly
 * the broader of the two.
 *
 * Returns a Map of listingId -> "property" | "lease".
 */
export async function getOwnedListings(userId) {
  const owned = new Map();
  if (!userId) return owned;

  const [{ data: landlordRows }, { data: leaseRows }] = await Promise.all([
    supabase.from("listing_landlords").select("listing_id").eq("user_id", userId),
    supabase
      .from("unit_leases")
      .select("id, listing_units!unit_id(listing_id, deleted_at)")
      .eq("owner_id", userId),
  ]);

  for (const row of leaseRows ?? []) {
    const unit = row.listing_units;
    if (unit?.listing_id && !unit.deleted_at) owned.set(unit.listing_id, "lease");
  }
  // Applied second so property ownership overwrites a lease-only tag.
  for (const row of landlordRows ?? []) {
    if (row.listing_id) owned.set(row.listing_id, "property");
  }

  return owned;
}

/**
 * Whether the user has ANY stake at this property — they own the listing record,
 * or they own a live offering on one of its units.
 *
 * This is the right gate for things that belong to the place rather than to the
 * listing row, photos above all: a landlord letting a unit here has every reason
 * to add pictures of it, and no reason to be able to edit the building's record.
 * Use isPropertyOwner for anything that changes the property itself.
 */
export async function hasStakeInListing(userId, listingId) {
  if (!userId || !listingId) return false;
  if (await isPropertyOwner(userId, listingId)) return true;

  const { data } = await supabase
    .from("unit_leases")
    .select("id, listing_units!unit_id(listing_id, deleted_at)")
    .eq("owner_id", userId);

  return (data ?? []).some(
    (row) => row.listing_units?.listing_id === listingId && !row.listing_units?.deleted_at
  );
}

/**
 * Property-level control: may edit the shared listing row, its unit set, and
 * delete it. Backed by listing_landlords alone — holding a lease is deliberately
 * NOT enough.
 */
export async function isPropertyOwner(userId, listingId) {
  if (!userId || !listingId) return false;
  const { data } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("listing_id", listingId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

/**
 * Lease-level control: may edit this one offering. Resolves the lease's unit and
 * parent listing in the same round trip so callers can report which property the
 * lease belongs to without a second query.
 *
 * Returns { ok, lease, listingId, reason }.
 */
export async function canManageLease(userId, leaseId) {
  if (!userId || !leaseId) return { ok: false, reason: "missing" };

  const { data: lease, error } = await supabase
    .from("unit_leases")
    .select("id, owner_id, unit_id, listing_units!unit_id(listing_id, deleted_at)")
    .eq("id", leaseId)
    .maybeSingle();

  if (error) return { ok: false, reason: "error" };
  if (!lease || lease.listing_units?.deleted_at) {
    return { ok: false, reason: "not_found" };
  }

  const listingId = lease.listing_units?.listing_id ?? null;

  // An unclaimed lease (imported listing with a contact but no account) has no
  // owner. It is not "everyone's" — nobody may edit it through this path.
  if (!lease.owner_id || lease.owner_id !== userId) {
    return { ok: false, listingId, reason: "forbidden" };
  }

  return { ok: true, lease, listingId };
}
