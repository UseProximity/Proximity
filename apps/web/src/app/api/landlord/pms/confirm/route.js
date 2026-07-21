export const dynamic = "force-dynamic";
export const maxDuration = 120;
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { fetchAllWalkTimes } from "@/utils/walkTimes";
import { deriveLeaseAvailability } from "@/utils/listingFormatters";
import { fetchAndStoreStreetView } from "@/lib/streetview";
import { isApiProvider, getConnector } from "@/lib/pms/index.js";
import { joinAddress } from "@/lib/pms/types.js";
import { groupUnitsToTypes, matchUnitsToListingUnits } from "@/lib/pms/mapping.js";

const PROVIDER_LABELS = { buildium: "Buildium", appfolio: "AppFolio", doorloop: "DoorLoop" };

async function requireLandlordOrSuper() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!["landlord", "super"].includes(session.user.role)) return null;
  return session;
}

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

// Upsert one pms_links row on its natural key.
async function upsertLink(row) {
  const { error } = await supabase
    .from("pms_links")
    .upsert(row, { onConflict: "connection_id,external_property_id,external_unit_id,external_bed_id" });
  if (error) {
    // The natural key uses COALESCE-ed expressions, which PostgREST upsert can't
    // always target — fall back to delete+insert on the same key.
    let del = supabase
      .from("pms_links")
      .delete()
      .eq("connection_id", row.connection_id)
      .eq("external_property_id", row.external_property_id);
    del = row.external_unit_id == null ? del.is("external_unit_id", null) : del.eq("external_unit_id", row.external_unit_id);
    del = row.external_bed_id == null ? del.is("external_bed_id", null) : del.eq("external_bed_id", row.external_bed_id);
    await del;
    const { error: insErr } = await supabase.from("pms_links").insert(row);
    if (insErr) throw new Error(insErr.message);
  }
}

// Best-effort walk times for an ingested listing (mirrors addListing).
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
 * POST /api/landlord/pms/confirm — apply the landlord's one-time dedupe
 * decisions from the discover screen:
 *   { connectionId, decisions: [{ externalPropertyId, action, listingId? }] }
 *   action: "ingest" (create a new listing from PMS facts + Street View cover),
 *           "link"   (attach to one of THEIR existing listings),
 *           "exclude"(never sync this property).
 * The snapshot is re-fetched server-side — client-supplied facts are never
 * trusted, only the decisions. From here on the daily cron keeps everything
 * fresh with no human in the loop.
 */
export async function POST(req) {
  const session = await requireLandlordOrSuper();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { connectionId, decisions } = await req.json().catch(() => ({}));
  if (!connectionId || !Array.isArray(decisions) || decisions.length === 0) {
    return NextResponse.json({ error: "connectionId and decisions are required" }, { status: 400 });
  }

  const { data: connection } = await supabase
    .from("pms_connections")
    .select("id, user_id, provider, nango_connection_id, status")
    .eq("id", connectionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!connection || connection.user_id !== session.user.id) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (!isApiProvider(connection.provider)) {
    return NextResponse.json({ error: "Connection is not an API provider" }, { status: 400 });
  }

  const connector = getConnector(connection.provider);
  const snapshot = await connector.fetchSnapshot(connection.nango_connection_id);
  const byExternalId = new Map(snapshot.properties.map((p) => [p.externalPropertyId, p]));
  const providerLabel = PROVIDER_LABELS[connection.provider] || connection.provider;
  const source = `pms:${connection.provider}`;

  const { data: owned } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("user_id", session.user.id);
  const ownedIds = new Set((owned ?? []).map((r) => r.listing_id));

  const results = [];
  for (const decision of decisions) {
    const { externalPropertyId, action, listingId } = decision || {};
    const prop = byExternalId.get(String(externalPropertyId));
    if (!prop) {
      results.push({ externalPropertyId, action, error: "Property not in the PMS snapshot" });
      continue;
    }

    try {
      if (action === "exclude") {
        await upsertLink({
          connection_id: connection.id,
          external_property_id: prop.externalPropertyId,
          external_unit_id: null,
          external_bed_id: null,
          external_label: prop.name || prop.address,
          listing_id: null,
          listing_unit_id: null,
          include: false,
          origin: "linked",
          link_status: "rejected",
        });
        results.push({ externalPropertyId, action, ok: true });
        continue;
      }

      if (action === "link") {
        if (!listingId || !ownedIds.has(listingId)) {
          results.push({ externalPropertyId, action, error: "listingId missing or not yours" });
          continue;
        }
        const { data: listingUnits } = await supabase
          .from("listing_units")
          .select("id, bedrooms, bathrooms")
          .eq("listing_id", listingId)
          .is("deleted_at", null);
        const unitMap = matchUnitsToListingUnits(prop.units, listingUnits ?? []);

        for (const u of prop.units) {
          await upsertLink({
            connection_id: connection.id,
            external_property_id: prop.externalPropertyId,
            external_unit_id: u.externalUnitId,
            external_bed_id: null,
            external_label: [prop.name || prop.address, u.label].filter(Boolean).join(" — "),
            listing_id: listingId,
            listing_unit_id: unitMap.get(u.externalUnitId) ?? null,
            include: true,
            origin: "linked",
            link_status: "confirmed",
          });
        }

        await supabase.rpc("rpc_pms_apply", {
          p_user_id: session.user.id,
          p_listing_id: listingId,
          p_listing_updates: { pms_connection_id: connection.id },
        });
        await supabase.rpc("rpc_pms_mark_verified", {
          p_user_id: session.user.id,
          p_listing_id: listingId,
          p_source: source,
        });
        results.push({ externalPropertyId, action, listingId, ok: true });
        continue;
      }

      if (action === "ingest") {
        const fullAddress = joinAddress(prop.address, prop.city, prop.state, prop.zip);
        if (!fullAddress) {
          results.push({ externalPropertyId, action, error: "Property has no address in the PMS" });
          continue;
        }
        const geo = await geocodeAddress(fullAddress);
        if (!geo) {
          results.push({ externalPropertyId, action, error: "Address could not be geocoded" });
          continue;
        }

        const groups = groupUnitsToTypes(prop.units);
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
          `${prop.name || "This property"} syncs straight from the landlord's ` +
          `property management system (${providerLabel}), so availability and ` +
          `pricing stay current automatically. The landlord hasn't written a ` +
          `custom description yet — reach out for details.`;

        const { data: newListingId, error: rpcError } = await supabase.rpc("rpc_pms_ingest_listing", {
          p_user_id: session.user.id,
          p_connection_id: connection.id,
          p_listing_data: {
            title: prop.name || null,
            address: fullAddress,
            longitude: geo.longitude,
            latitude: geo.latitude,
            description,
            lease_type: "standard",
            sublease_friendly: false,
            twenty_one_plus: false,
            furnished: false,
            contact_email: session.user.email ?? null,
            contact_name: session.user.name ?? null,
            lease_availability: deriveLeaseAvailability(unitData),
            unavailable: false,
            deleted_at: null,
          },
          p_walk_times: await walkTimeRowsFor(geo.latitude, geo.longitude),
          p_units: unitData,
          p_source: source,
        });
        if (rpcError) throw new Error(rpcError.message);

        // Map each physical PMS unit to the created type row.
        const { data: createdUnits } = await supabase
          .from("listing_units")
          .select("id, bedrooms, bathrooms")
          .eq("listing_id", newListingId)
          .is("deleted_at", null);
        const unitMap = matchUnitsToListingUnits(prop.units, createdUnits ?? []);

        for (const u of prop.units) {
          await upsertLink({
            connection_id: connection.id,
            external_property_id: prop.externalPropertyId,
            external_unit_id: u.externalUnitId,
            external_bed_id: null,
            external_label: [prop.name || prop.address, u.label].filter(Boolean).join(" — "),
            listing_id: newListingId,
            listing_unit_id: unitMap.get(u.externalUnitId) ?? null,
            include: true,
            origin: "ingested",
            link_status: "confirmed",
          });
        }

        // Street View cover photo — best-effort, never blocks.
        try {
          await fetchAndStoreStreetView({
            supabase,
            listingId: newListingId,
            address: fullAddress,
            lat: geo.latitude,
            lng: geo.longitude,
            sortOrder: 0,
          });
        } catch {}

        results.push({ externalPropertyId, action, listingId: newListingId, ok: true });
        continue;
      }

      results.push({ externalPropertyId, action, error: "Unknown action" });
    } catch (err) {
      console.error("[pms/confirm]", externalPropertyId, err?.message);
      results.push({ externalPropertyId, action, error: "Failed to apply this decision" });
    }
  }

  return NextResponse.json({ results });
}
