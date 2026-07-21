/*
 * Create a Proximity listing from a normalized PMS property (shared by the
 * confirm route and the daily sync cron, which auto-ingests properties that
 * appear in the PMS later). Facts + walk times + Street View cover only —
 * descriptions and photos are the landlord's voice and are never generated
 * beyond the placeholder here or overwritten later.
 */
import supabase from "@/lib/supabase";
import { fetchAllWalkTimes } from "@/utils/walkTimes";
import { deriveLeaseAvailability } from "@/utils/listingFormatters";
import { fetchAndStoreStreetView } from "@/lib/streetview";
import { joinAddress } from "./types.js";
import { groupUnitsToTypes, matchUnitsToListingUnits } from "./mapping.js";

// Local copy of the private geocodeAddress helper (deliberately duplicated).
async function geocodeAddress(address) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=1&country=US`;
  const res = await fetch(url);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.center;
  return { latitude: lat, longitude: lng };
}

// Best-effort walk times (mirrors addListing's locations-table resolution).
async function walkTimeRowsFor(lat, lng) {
  try {
    const { placeWalkMinutes, shuttleWalkMinutes } = await fetchAllWalkTimes(lat, lng);
    const { data: locations } = await supabase.from("locations").select("id, name");
    if (!locations?.length) return [];
    const rows = [];
    for (const [key, minutes] of Object.entries(placeWalkMinutes ?? {})) {
      const loc = locations.find((l) => l.name.toLowerCase() === key.toLowerCase());
      if (loc && minutes != null) rows.push({ location_id: loc.id, minutes });
    }
    if (shuttleWalkMinutes != null) {
      const shuttleLoc = locations.find((l) => l.name.toLowerCase() === "shuttle_nearest");
      if (shuttleLoc) rows.push({ location_id: shuttleLoc.id, minutes: shuttleWalkMinutes });
    }
    return rows;
  } catch {
    return [];
  }
}

/*
 * Ingest one PMS property as a new listing owned by `ownerId`.
 * Returns { listingId, unitMap } (external unit id -> listing_unit_id) or
 * throws with a human-readable reason.
 */
export async function ingestPmsProperty({
  property,
  connection,
  ownerId,
  contactEmail = null,
  contactName = null,
}) {
  const fullAddress = joinAddress(property.address, property.city, property.state, property.zip);
  if (!fullAddress) throw new Error("Property has no address in the PMS");

  const geo = await geocodeAddress(fullAddress);
  if (!geo) throw new Error("Address could not be geocoded");

  const groups = groupUnitsToTypes(property.units);
  const unitData = groups.map(({ type }) => ({
    bedrooms: type.bedrooms,
    bathrooms: type.bathrooms ?? 1,
    area: type.area,
    rent: type.rent,
    title: null,
    floorPlanImageUrl: null,
    leaseTermMonths: [],
    leaseAvailability: type.leaseAvailability,
    available: type.available,
    sublease: false,
  }));

  const description =
    `Pricing and availability at ${property.name || "this property"} sync live ` +
    `from the landlord's system — what you see is current. No description from ` +
    `the landlord yet. Message them and ask.`;

  const { data: listingId, error } = await supabase.rpc("rpc_pms_ingest_listing", {
    p_user_id: ownerId,
    p_connection_id: connection.id,
    p_listing_data: {
      title: property.name || null,
      address: fullAddress,
      longitude: geo.longitude,
      latitude: geo.latitude,
      description,
      lease_type: "standard",
      sublease_friendly: false,
      twenty_one_plus: false,
      furnished: false,
      contact_email: contactEmail,
      contact_name: contactName,
      lease_availability: deriveLeaseAvailability(unitData),
      unavailable: false,
      deleted_at: null,
    },
    p_walk_times: await walkTimeRowsFor(geo.latitude, geo.longitude),
    p_units: unitData,
    p_source: `pms:${connection.provider}`,
  });
  if (error) throw new Error(error.message);

  const { data: createdUnits } = await supabase
    .from("listing_units")
    .select("id, bedrooms, bathrooms")
    .eq("listing_id", listingId)
    .is("deleted_at", null);
  const unitMap = matchUnitsToListingUnits(property.units, createdUnits ?? []);

  // Street View cover photo — best-effort, never blocks.
  try {
    await fetchAndStoreStreetView({
      supabase,
      listingId,
      address: fullAddress,
      lat: geo.latitude,
      lng: geo.longitude,
      sortOrder: 0,
    });
  } catch {}

  return { listingId, unitMap };
}
