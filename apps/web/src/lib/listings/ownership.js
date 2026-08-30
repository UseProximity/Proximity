import supabase from "@/lib/supabase";

/*
 * Ids arrive from URL segments, so they are whatever the caller typed. The id
 * columns are uuid, and Postgres raises on a malformed one — which used to
 * surface as a 500 "could not load", reporting a client's typo as a server
 * crash. Worse, finding that out cost a database round trip; on a cold
 * serverless instance that was slow enough to blow a caller's timeout.
 *
 * Checking the shape first makes a bad id cheap and honest: no query, and a
 * "malformed" reason the routes turn into a 400.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

/*
 * Who owns what, now that a property can carry offerings from several landlords.
 *
 * There are two DIFFERENT kinds of ownership and conflating them is a privilege
 * escalation, not a convenience:
 *
 *   PROPERTY ownership (listing_landlords)
 *     Control of the shared listing row — address, coordinates, amenities, and
 *     the unit set. `PATCH /api/landlord/listings/[id]` rewrites the building's
 *     record and `DELETE` removes it outright, so this must stay limited to
 *     whoever actually owns that record.
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
 *
 * CONTRIBUTING is not OWNING, and the difference is what makes the split usable
 * rather than merely safe. Someone letting a unit here can add a unit to the
 * property, photograph the unit they let, supply a floor plan the property has
 * none of, and publish their own price, terms, description and contact. Every
 * one of those either creates a row that is theirs or fills a blank; none of
 * them changes something that was already someone else's. That is the line each
 * predicate below draws, and the line the routes enforce.
 *
 * Subletting never confers property ownership at all — not even by being first.
 * rpc_create_listing takes p_claim_property precisely so that a student posting
 * a sublease at an address nobody has listed yet gets the lease and leaves the
 * property unclaimed (202608300001_create_listing_claim.sql). Before that flag,
 * being first made you the primary landlord of a house you rent one room in,
 * which is how production came to hold subletter-owned property records at
 * 5803 Waterman and 729 Westgate.
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
  if (!isUuid(userId)) return owned;

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
 * Whether the user holds a stake ANYWHERE — a property record, or a live
 * offering on someone else's unit.
 *
 * This is the gate for reaching the property dashboard at all, as opposed to
 * reaching one particular property (hasStakeInListing) or changing it
 * (isPropertyOwner). It exists because the dashboard is not a landlord feature:
 * a student subletting their room holds a lease exactly the way a landlord
 * does, and every endpoint behind the dashboard already authorizes on ownership
 * rather than role. Only the door was checking for a role.
 */
export async function hasAnyStake(userId) {
  if (!isUuid(userId)) return false;

  const [{ data: landlordRows }, { data: leaseRows }] = await Promise.all([
    supabase.from("listing_landlords").select("listing_id").eq("user_id", userId).limit(1),
    supabase
      .from("unit_leases")
      .select("id")
      .eq("owner_id", userId)
      .eq("is_active", true)
      .limit(1),
  ]);

  return !!(landlordRows?.length || leaseRows?.length);
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
  if (!isUuid(userId) || !isUuid(listingId)) return false;
  if (await isPropertyOwner(userId, listingId)) return true;

  const { data } = await supabase
    .from("unit_leases")
    .select("id, listing_units!unit_id(listing_id, deleted_at)")
    .eq("owner_id", userId);

  return (data ?? []).some(
    (row) => row.listing_units?.listing_id === listingId && !row.listing_units?.deleted_at
  );
}

/*
 * ——— Photo permissions ———————————————————————————————————————————————————
 *
 * Photos carry a scope: listing_images.unit_id is null for a picture of the
 * PROPERTY and set for a picture of one UNIT. The two answer to different
 * people, which is the whole point — a subletter should be able to picture the
 * apartment they are letting without touching the building's record.
 */

/**
 * May add or remove photos of the PROPERTY itself — the exterior, the lobby,
 * the shared spaces. The building's record is the property owner's, so this is
 * isPropertyOwner and nothing looser.
 */
export async function canManagePropertyPhotos(userId, listingId) {
  return isPropertyOwner(userId, listingId);
}

/**
 * May add photos of ONE unit: anyone currently offering it, plus the property
 * owner. Withdrawn offerings still count — a landlord whose lease is between
 * tenants has not stopped owning their listing.
 *
 * Returns { ok, listingId, reason } so callers can 404 a missing unit apart
 * from 403-ing a real one.
 */
export async function canAddUnitPhotos(userId, unitId) {
  if (!userId || !unitId) return { ok: false, reason: "missing" };
  if (!isUuid(unitId)) return { ok: false, reason: "malformed" };

  const { data: unit, error } = await supabase
    .from("listing_units")
    .select("id, listing_id, deleted_at")
    .eq("id", unitId)
    .maybeSingle();

  if (error) return { ok: false, reason: "error" };
  if (!unit || unit.deleted_at) return { ok: false, reason: "not_found" };

  if (await isPropertyOwner(userId, unit.listing_id)) {
    return { ok: true, listingId: unit.listing_id };
  }

  const { data: lease } = await supabase
    .from("unit_leases")
    .select("id")
    .eq("unit_id", unitId)
    .eq("owner_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  return lease
    ? { ok: true, listingId: unit.listing_id }
    : { ok: false, listingId: unit.listing_id, reason: "forbidden" };
}

/**
 * May remove ONE photo. Whoever uploaded it can take it down, and the property
 * owner can prune anything on their building.
 *
 * Deliberately NOT "any lease owner on the unit": several landlords can offer
 * the same unit, and one must never be able to delete another's pictures.
 * Photos predating attribution (owner_id null) are the property owner's to
 * manage, since nobody else can be shown to have added them.
 */
export async function canDeletePhoto(userId, imageId) {
  if (!userId || !imageId) return { ok: false, reason: "missing" };
  if (!isUuid(imageId)) return { ok: false, reason: "malformed" };

  const { data: image, error } = await supabase
    .from("listing_images")
    .select("id, listing_id, unit_id, owner_id, url")
    .eq("id", imageId)
    .maybeSingle();

  if (error) return { ok: false, reason: "error" };
  if (!image) return { ok: false, reason: "not_found" };

  if (image.owner_id && image.owner_id === userId) return { ok: true, image };
  if (await isPropertyOwner(userId, image.listing_id)) return { ok: true, image };

  return { ok: false, image, reason: "forbidden" };
}

/**
 * Property-level control: may edit the shared listing row, its unit set, and
 * delete it. Backed by listing_landlords alone — holding a lease is deliberately
 * NOT enough.
 */
export async function isPropertyOwner(userId, listingId) {
  if (!isUuid(userId) || !isUuid(listingId)) return false;
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
  if (!isUuid(leaseId)) return { ok: false, reason: "malformed" };

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
