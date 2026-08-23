import supabase from "@/lib/supabase";
import { auth } from "@/auth";

// Look up whether a property already exists at an address, and if so return its
// units and the live leases on each. This drives the address -> unit -> lease
// create flow: entering a known address attaches to the existing property rather
// than creating a second one.
//
// Several listing rows can still share a property_key (duplicates predating the
// property model), so the match is collapsed into a SINGLE property view here —
// the oldest row is the canonical property and every matching row's units are
// unioned onto it. That way the create flow behaves correctly even before the
// duplicate rows have been merged in the database.
//
// @auth user
export async function GET(req) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const address = new URL(req.url).searchParams.get("address")?.trim();
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
         id, unit_designator, unit_number, bedrooms, bathrooms, area, available, deleted_at,
         unit_leases!unit_id(id, rent, sublease, is_active, unavailable, owner_id, contact_name)
       )`
    )
    .eq("property_key", propertyKey)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[properties/lookup] Lookup failed:", error.message);
    return Response.json({ error: "Could not look up that address." }, { status: 500 });
  }

  if (!rows?.length) return Response.json({ propertyKey, property: null });

  const canonical = rows[0];
  const userId = session.user.id;

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
        sublease: !!lease.sublease,
        // "Live" mirrors the unit_leases_sublease_guard trigger: an offering the
        // owner has withdrawn no longer blocks a sublease.
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
        available: unit.available,
        leases,
        liveLeaseCount: liveLeases.length,
        // Enforced for real by the database trigger; surfaced here so the form
        // can disable the option instead of failing on submit.
        canAddSublease: liveLeases.length === 0,
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

  return Response.json({
    propertyKey,
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
