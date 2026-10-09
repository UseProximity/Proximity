import supabase from "@/lib/supabase";
import { auth } from "@/auth";
import { unitIsAvailable } from "@/lib/listings/unitAvailability";
import { lookupClientKey, lookupRateLimited } from "@/lib/listings/lookupRateLimit";
import { listingsAtAddress } from "@/lib/listings/propertyName";

// Look up whether a property already exists at an address, and if so return its
// units and the live leases on each. This drives the address -> unit -> lease
// create flow: entering a known address attaches to the existing property rather
// than creating a second one.
//
// Open to visitors, because Add Listing lets someone fill the whole form before
// asking for an account. A signed-out caller gets what browse already shows
// (address, units, whether an offering is live, its rent) and nothing about who
// owns it: no owner ids, no contact names, and no "is this mine" flags. They are
// rate limited per client, since there is no account to attribute a scan to.
//
// Several listing rows can still share a property_key (duplicates predating the
// property model), so the match is collapsed into a SINGLE property view here —
// the oldest row is the canonical property and every matching row's units are
// unioned onto it. That way the create flow behaves correctly even before the
// duplicate rows have been merged in the database.
//
// `listingId` (signed in only) narrows the answer to that one row, for the
// import's "this is already yours" tab, which edits exactly the listing the
// landlord has rather than the union of every duplicate at the address.
//
// @auth public
export async function GET(req) {
  const session = await auth();
  if (!session && lookupRateLimited(lookupClientKey(req))) {
    return Response.json({ error: "Too many lookups. Try again shortly." }, { status: 429 });
  }

  const params = new URL(req.url).searchParams;
  const address = params.get("address")?.trim();
  const onlyListingId = session ? params.get("listingId") : null;
  if (!address) {
    return Response.json({ error: "An address is required." }, { status: 400 });
  }

  // Reuse the database's own normalizer so the client and the stored
  // property_key can never disagree about what counts as the same address.
  const { data: propertyKey, error: keyError } = await supabase.rpc(
    "normalize_property_key",
    { p_address: address }
  );

  if (keyError) {
    console.error("[properties/lookup] Failed to normalize address:", keyError.message);
    return Response.json({ error: "Could not read that address." }, { status: 500 });
  }

  if (!propertyKey) return Response.json({ propertyKey: null, property: null });

  const { data: rows, error } = await supabase
    .from("listings")
    .select(
      `id, title, address, latitude, longitude, created_at,
       listing_units!listing_id(
         id, unit_designator, unit_number, bedrooms, bathrooms, area, deleted_at,
         title, floor_plan_image_url,
         unit_leases!unit_id(
           id, rent, rent_is_per_person, lease_term_months, available_from,
           sublease, is_active, unavailable, owner_id, contact_name
         )
       )`
    )
    // No ZIP in what was typed or read ("716 heman avenue|"): any listing at
    // that street address, whatever its ZIP. See listingsAtAddress.
    [propertyKey.endsWith("|") ? "like" : "eq"]("property_key", propertyKey.endsWith("|") ? `${propertyKey}%` : propertyKey)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (!error && onlyListingId) {
    const one = (rows ?? []).filter((r) => r.id === onlyListingId);
    rows.length = 0;
    rows.push(...one);
  }

  if (error) {
    console.error("[properties/lookup] Lookup failed:", error.message);
    return Response.json({ error: "Could not look up that address." }, { status: 500 });
  }

  if (!rows?.length) return Response.json({ propertyKey, property: null });

  const canonical = rows[0];
  const userId = session?.user?.id ?? null;

  const units = rows
    .flatMap((row) =>
      (row.listing_units ?? [])
        .filter((unit) => !unit.deleted_at)
        .map((unit) => ({ unit, listingId: row.id }))
    )
    .map(({ unit, listingId }) => {
      const leases = (unit.unit_leases ?? []).map((lease) => ({
        id: lease.id,
        rent: lease.rent,
        // What the landlord needs to edit an offering of their own in place.
        rentIsPerPerson: !!lease.rent_is_per_person,
        leaseTermMonths: lease.lease_term_months ?? [],
        availableFrom: lease.available_from ?? null,
        unavailable: !!lease.unavailable,
        sublease: !!lease.sublease,
        // Whether a renter could take this offering today.
        live: !!lease.is_active && !lease.unavailable,
        ownerId: lease.owner_id,
        contactName: lease.contact_name,
        isMine: !!lease.owner_id && lease.owner_id === userId,
      }));

      const liveLeases = leases.filter((l) => l.live);

      return {
        id: unit.id,
        listingId,
        designator: unit.unit_designator,
        number: unit.unit_number,
        // Legacy units carry no identity — the client must render these as
        // "unlabelled" rather than pretending they are distinguishable.
        identified: !!unit.unit_designator,
        label: unit.unit_designator
          ? unit.unit_designator === "Whole"
            ? "Whole property"
            : `${unit.unit_designator} ${unit.unit_number}`
          : null,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        area: unit.area,
        title: unit.title ?? null,
        floorPlanImageUrl: unit.floor_plan_image_url ?? null,
        available: unitIsAvailable(unit),
        leases,
        liveLeaseCount: liveLeases.length,
        /*
         * Always. Subletting is taking over part of a lease that exists, so a
         * unit already being let is the normal case for it — the guard that
         * refused this was removed in 202608240003. Kept as a field so callers
         * don't have to know it is now unconditional.
         */
        canAddSublease: true,
      };
    });

  // Duplicate listing rows at one address routinely describe the SAME physical
  // unit — three landlords each listing "729 Westgate" produce three separate
  // "Whole property" units. Presenting those as three choices is meaningless, so
  // identified units sharing a designator+number are merged into one option with
  // their leases pooled. This is the same collapse the database merge performs,
  // applied at read time so the picker is correct before that merge has run.
  //
  // Unidentified units are never merged: with no identity there is nothing to
  // match on, and merging on bed/bath alone would fuse genuinely distinct units.
  const mergedUnits = [];
  const byIdentity = new Map();

  for (const unit of units) {
    if (!unit.identified) {
      mergedUnits.push(unit);
      continue;
    }
    const identityKey = `${unit.designator}|${unit.number ?? ""}`;
    const existing = byIdentity.get(identityKey);
    if (!existing) {
      byIdentity.set(identityKey, unit);
      mergedUnits.push(unit);
      continue;
    }
    existing.leases.push(...unit.leases);
    existing.duplicateUnitIds = [...(existing.duplicateUnitIds ?? []), unit.id];
    existing.liveLeaseCount = existing.leases.filter((l) => l.live).length;
    existing.canAddSublease = existing.liveLeaseCount === 0;
  }

  const ownerIds = new Set(
    mergedUnits.flatMap((u) => u.leases.filter((l) => l.live && l.ownerId).map((l) => l.ownerId))
  );

  // The count above is safe to share; the ids and names behind it are not. The
  // client only reads isMine, which a signed-out caller cannot have.
  if (!session) {
    for (const unit of mergedUnits) {
      unit.leases = unit.leases.map(({ ownerId, contactName, isMine, ...lease }) => lease);
    }
  }

  /*
   * Which of the rows at this address are the caller's own, so the import can
   * open theirs for editing rather than attaching to someone else's. Signed in
   * only: whose a listing is is not a visitor's business.
   */
  const atAddress = session
    ? await listingsAtAddress(address, userId)
    : { listings: [], match: null };

  return Response.json({
    propertyKey,
    listings: atAddress.listings,
    match: atAddress.match,
    property: {
      id: canonical.id,
      title: canonical.title,
      address: canonical.address,
      latitude: canonical.latitude,
      longitude: canonical.longitude,
      // >1 means the duplicate rows behind this key have not been merged yet.
      listingRowCount: rows.length,
      ownerCount: ownerIds.size,
      viewerHasLease: mergedUnits.some((u) => u.leases.some((l) => l.isMine)),
      units: mergedUnits,
    },
  });
}
