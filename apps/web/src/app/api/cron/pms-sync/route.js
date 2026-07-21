export const dynamic = "force-dynamic";
export const maxDuration = 300;
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getConnector, isApiProvider } from "@/lib/pms/index.js";
import { ingestPmsProperty } from "@/lib/pms/ingest.js";
import {
  applyLeasingHorizon,
  leasingHorizonEnd,
  rollUpAvailability,
  rollUpRent,
  rollUpAvailableFrom,
  matchUnitsToListingUnits,
} from "@/lib/pms/mapping.js";

/*
 * Daily PMS sync — the PMS is the source of truth (ILS-feed semantics):
 *   unit present in the snapshot -> availability/rent applied
 *   unit missing from the snapshot -> treated as leased/removed (delists)
 *   new unit/property -> linked or auto-ingested
 *   available:null (unknown) -> NO action, never stale
 * Availability is evaluated against the pre-leasing horizon (mapping.js):
 * vacant now OR lease ending within ~12 months counts as available, surfaced
 * as "Available <date>" — a fully pre-leased building is not stale.
 * Safety rails:
 *   - a broken pull (empty snapshot + errors) refuses to reconcile
 *   - the ±20% swing guard holds any sync that would change too much of a
 *     connection's portfolio at once (review row; nothing applied)
 *   - price updates are gated by sync_price + a 2% change threshold
 *   - auto_apply=false runs the whole sync as a DRY RUN: every intended
 *     change is logged to pms_sync_events with applied=false, nothing written
 *     to listings — read the events for 1–2 weeks, then flip it live
 * All writes go through the audit-safe RPCs as the reserved system actor.
 */

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
const PRICE_CHANGE_MIN_RATIO = 0.02; // ignore sub-2% price noise
const SWING_RATIO = 0.2;             // hold when >20% of tracked units change…
const SWING_MIN_CHANGES = 3;         // …and at least this many units are affected

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: connections } = await supabase
    .from("pms_connections")
    .select("id, user_id, provider, nango_connection_id, radius_auto_include_km, sync_price, auto_apply, status")
    .eq("status", "active")
    .is("deleted_at", null);

  const summary = [];
  for (const connection of connections ?? []) {
    // Scrape/aggregator providers have no API connector — their signal-only
    // path lives elsewhere (review queue). API connections always sync; with
    // auto_apply=false the sync observes and logs instead of writing.
    if (!isApiProvider(connection.provider)) continue;
    try {
      summary.push(await syncConnection(connection, { dryRun: !connection.auto_apply }));
    } catch (err) {
      console.error("[pms-sync]", connection.id, err?.message);
      await supabase
        .from("pms_connections")
        .update({ last_sync_at: new Date().toISOString(), last_sync_status: "error", last_sync_error: (err?.message || "sync failed").slice(0, 500) })
        .eq("id", connection.id);
      summary.push({ connectionId: connection.id, status: "error", error: err?.message });
    }
  }

  return NextResponse.json({ synced: summary.length, summary });
}

async function logEvents(rows) {
  if (rows.length) await supabase.from("pms_sync_events").insert(rows);
}

async function syncConnection(connection, { dryRun = false } = {}) {
  const source = `pms:${connection.provider}`;
  const connector = getConnector(connection.provider);
  const snapshot = await connector.fetchSnapshot(connection.nango_connection_id);
  const horizonEnd = leasingHorizonEnd();
  const today = new Date().toISOString().slice(0, 10);

  // Broken pull: refuse to reconcile — a fetch failure must never delist anyone.
  if (!snapshot.properties.length) {
    await supabase
      .from("pms_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "error",
        last_sync_error: (snapshot.errors.join("; ") || "empty snapshot").slice(0, 500),
      })
      .eq("id", connection.id);
    return { connectionId: connection.id, status: "error", error: "empty snapshot" };
  }

  const { data: allLinks } = await supabase
    .from("pms_links")
    .select("id, external_property_id, external_unit_id, external_bed_id, listing_id, listing_unit_id, include, link_status")
    .eq("connection_id", connection.id);
  const links = (allLinks ?? []).filter((l) => l.link_status !== "rejected");
  const excludedProperties = new Set(
    (allLinks ?? []).filter((l) => !l.include).map((l) => l.external_property_id)
  );

  const unitLinks = links.filter((l) => l.include && l.external_unit_id != null && l.listing_id);

  // Snapshot units on non-excluded properties, keyed like pms_links.
  const snapUnits = new Map(); // "propId|unitId" -> { property, unit }
  for (const property of snapshot.properties) {
    if (excludedProperties.has(property.externalPropertyId)) continue;
    for (const unit of property.units) {
      snapUnits.set(`${property.externalPropertyId}|${unit.externalUnitId}`, { property, unit });
    }
  }

  const linkKey = (l) => `${l.external_property_id}|${l.external_unit_id}`;
  const trackedKeys = new Set(unitLinks.map(linkKey));
  const missing = unitLinks.filter((l) => !snapUnits.has(linkKey(l)));
  const fresh = [...snapUnits.keys()].filter((k) => !trackedKeys.has(k));

  // ±20% swing guard: too much portfolio change at once -> hold everything.
  const changes = missing.length + fresh.length;
  if (unitLinks.length > 0 && changes >= SWING_MIN_CHANGES && changes / unitLinks.length > SWING_RATIO) {
    const { data: openHold } = await supabase
      .from("pms_review_queue")
      .select("id")
      .eq("connection_id", connection.id)
      .eq("reason", "swing_guard_hold")
      .eq("status", "open")
      .maybeSingle();
    if (!openHold) {
      await supabase.from("pms_review_queue").insert({
        connection_id: connection.id,
        reason: "swing_guard_hold",
        detail: { tracked: unitLinks.length, missing: missing.length, new: fresh.length },
      });
    }
    await logEvents([{
      connection_id: connection.id,
      result: "held",
      applied: false,
      detail: { tracked: unitLinks.length, missing: missing.length, new: fresh.length },
    }]);
    await supabase
      .from("pms_connections")
      .update({ last_sync_at: new Date().toISOString(), last_sync_status: "held", last_sync_error: null })
      .eq("id", connection.id);
    return { connectionId: connection.id, status: "held", missing: missing.length, new: fresh.length };
  }

  const events = [];
  const applied = { updated: 0, delisted: 0, relisted: 0, created: 0 };

  // ---- new units on already-tracked properties: link them in (create type rows as needed)
  const trackedListingByProperty = new Map();
  for (const l of unitLinks) {
    if (!trackedListingByProperty.has(l.external_property_id)) {
      trackedListingByProperty.set(l.external_property_id, l.listing_id);
    }
  }
  for (const key of fresh) {
    const { property, unit } = snapUnits.get(key);
    const listingId = trackedListingByProperty.get(property.externalPropertyId);
    if (!listingId) continue; // whole-property ingest handled below

    if (dryRun) {
      events.push({
        connection_id: connection.id,
        listing_id: listingId,
        external_unit_id: unit.externalUnitId,
        observed_available: unit.available,
        observed_rent: unit.rent,
        applied: false,
        result: "created",
        detail: { dryRun: true, kind: "unit", label: unit.label },
      });
      applied.created += 1;
      continue;
    }

    const { data: listingUnits } = await supabase
      .from("listing_units")
      .select("id, bedrooms, bathrooms")
      .eq("listing_id", listingId)
      .is("deleted_at", null);
    let unitTypeId = matchUnitsToListingUnits([unit], listingUnits ?? []).get(unit.externalUnitId);
    if (!unitTypeId && unit.bedrooms != null) {
      // No matching floor-plan type — create one as the system actor.
      const { data: created } = await supabase.rpc("rpc_insert_as_user", {
        p_user_id: SYSTEM_USER_ID,
        p_table: "listing_units",
        p_data: {
          listing_id: listingId,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms ?? 1,
          area: unit.area,
          available: unit.available !== false,
        },
      });
      unitTypeId = created?.id ?? null;
    }
    const { error } = await supabase.from("pms_links").insert({
      connection_id: connection.id,
      external_property_id: property.externalPropertyId,
      external_unit_id: unit.externalUnitId,
      external_bed_id: null,
      external_label: [property.name || property.address, unit.label].filter(Boolean).join(" — "),
      listing_id: listingId,
      listing_unit_id: unitTypeId,
      include: true,
      origin: "ingested",
      link_status: "confirmed",
    });
    if (!error) {
      unitLinks.push({
        external_property_id: property.externalPropertyId,
        external_unit_id: unit.externalUnitId,
        listing_id: listingId,
        listing_unit_id: unitTypeId,
        include: true,
      });
      applied.created += 1;
      events.push({
        connection_id: connection.id,
        listing_id: listingId,
        external_unit_id: unit.externalUnitId,
        observed_available: unit.available,
        observed_rent: unit.rent,
        applied: true,
        result: "created",
        detail: { kind: "unit" },
      });
    }
  }

  // ---- whole new properties: auto-ingest as listings owned by the landlord
  const knownProperties = new Set([
    ...(allLinks ?? []).map((l) => l.external_property_id),
  ]);
  for (const property of snapshot.properties) {
    if (knownProperties.has(property.externalPropertyId)) continue;
    if (excludedProperties.has(property.externalPropertyId)) continue;
    if (dryRun) {
      events.push({
        connection_id: connection.id,
        applied: false,
        result: "created",
        detail: {
          dryRun: true,
          kind: "property",
          externalPropertyId: property.externalPropertyId,
          name: property.name,
          units: property.units.length,
        },
      });
      applied.created += 1;
      continue;
    }
    try {
      const { data: ownerRow } = await supabase
        .from("users")
        .select("email, name")
        .eq("id", connection.user_id)
        .single();
      const { listingId, unitMap } = await ingestPmsProperty({
        property,
        connection,
        ownerId: connection.user_id,
        contactEmail: ownerRow?.email ?? null,
        contactName: ownerRow?.name ?? null,
      });
      for (const unit of property.units) {
        await supabase.from("pms_links").insert({
          connection_id: connection.id,
          external_property_id: property.externalPropertyId,
          external_unit_id: unit.externalUnitId,
          external_bed_id: null,
          external_label: [property.name || property.address, unit.label].filter(Boolean).join(" — "),
          listing_id: listingId,
          listing_unit_id: unitMap.get(unit.externalUnitId) ?? null,
          include: true,
          origin: "ingested",
          link_status: "confirmed",
        });
      }
      applied.created += 1;
      events.push({
        connection_id: connection.id,
        listing_id: listingId,
        applied: true,
        result: "created",
        detail: { kind: "property", externalPropertyId: property.externalPropertyId },
      });
    } catch (err) {
      events.push({
        connection_id: connection.id,
        applied: false,
        result: "error",
        detail: { kind: "property-ingest", externalPropertyId: property.externalPropertyId, error: err?.message },
      });
    }
  }

  // ---- reconcile every tracked listing
  const byListing = new Map();
  for (const l of unitLinks) {
    if (!byListing.has(l.listing_id)) byListing.set(l.listing_id, []);
    byListing.get(l.listing_id).push(l);
  }

  for (const [listingId, listingLinks] of byListing) {
    const { data: listing } = await supabase
      .from("listings")
      .select("id, unavailable, deleted_at")
      .eq("id", listingId)
      .maybeSingle();
    if (!listing || listing.deleted_at) continue;

    // Observed state per link: missing from the snapshot == leased/removed.
    // Availability is horizon-aware: vacant now OR freeing up within the
    // leasing horizon counts as available (vacant-now reports availableFrom =
    // today so "earliest move-in" rolls up correctly).
    const observed = listingLinks.map((l) => {
      const snap = snapUnits.get(linkKey(l));
      if (!snap) return { link: l, unit: null, available: false, rent: null, availableFrom: null };
      const [u] = applyLeasingHorizon([snap.unit], horizonEnd, today);
      return { link: l, unit: u, available: u.available, rent: u.rent, availableFrom: u.availableFrom };
    });

    // Roll physical units up to their floor-plan type rows.
    const byType = new Map();
    for (const o of observed) {
      if (!o.link.listing_unit_id) continue;
      if (!byType.has(o.link.listing_unit_id)) byType.set(o.link.listing_unit_id, []);
      byType.get(o.link.listing_unit_id).push(o);
    }

    const { data: typeRows } = await supabase
      .from("listing_units")
      .select("id, available, unit_leases(id, rent, available_from, is_active)")
      .eq("listing_id", listingId)
      .is("deleted_at", null);
    const typeById = new Map((typeRows ?? []).map((t) => [t.id, t]));

    const unitUpdates = [];
    const leaseUpdates = [];
    for (const [typeId, group] of byType) {
      const current = typeById.get(typeId);
      if (!current) continue;
      const nextAvailable = rollUpAvailability(group);
      if (nextAvailable != null && nextAvailable !== current.available) {
        unitUpdates.push({ id: typeId, available: nextAvailable });
      }

      const activeLease = (current.unit_leases ?? []).find((le) => le.is_active);
      const nextRent = rollUpRent(group.filter((o) => o.unit));
      const nextFrom = rollUpAvailableFrom(group.filter((o) => o.unit));
      const currentRent = activeLease?.rent != null ? Number(activeLease.rent) : null;
      const rentChanged =
        connection.sync_price &&
        nextRent != null &&
        (currentRent == null || Math.abs(nextRent - currentRent) / currentRent >= PRICE_CHANGE_MIN_RATIO);
      const currentFrom = activeLease?.available_from ?? null;
      // Any past-or-today date means "available now" — don't churn it daily.
      const bothNow = nextFrom != null && currentFrom != null && nextFrom <= today && currentFrom <= today;
      const fromChanged = nextFrom != null && nextFrom !== currentFrom && !bothNow;
      if (rentChanged || fromChanged) {
        leaseUpdates.push({
          unit_id: typeId,
          rent: rentChanged ? nextRent : null,
          available_from: fromChanged ? nextFrom : null,
        });
      }
    }

    // Listing-level availability: all types known-unavailable -> delist;
    // any known-available -> (re)list. Unknown -> leave alone.
    const knownStates = observed.map((o) => o.available).filter((a) => a != null);
    const anyAvailable = knownStates.some(Boolean);
    const listingUpdates = {};
    if (knownStates.length) {
      if (!anyAvailable && !listing.unavailable) listingUpdates.unavailable = true;
      if (anyAvailable && listing.unavailable) listingUpdates.unavailable = false;
    }

    const hasChanges = unitUpdates.length || leaseUpdates.length || Object.keys(listingUpdates).length;
    if (hasChanges) {
      const result = listingUpdates.unavailable === true
        ? "delisted"
        : listingUpdates.unavailable === false
          ? "relisted"
          : "updated";
      if (dryRun) {
        // Observe-and-log: record the full intended change, write nothing.
        applied[result === "delisted" ? "delisted" : result === "relisted" ? "relisted" : "updated"] += 1;
        events.push({
          connection_id: connection.id,
          listing_id: listingId,
          applied: false,
          result,
          detail: { dryRun: true, listingUpdates, unitUpdates, leaseUpdates },
        });
      } else {
        const { error } = await supabase.rpc("rpc_pms_apply", {
          p_user_id: SYSTEM_USER_ID,
          p_listing_id: listingId,
          p_listing_updates: Object.keys(listingUpdates).length ? listingUpdates : null,
          p_unit_updates: unitUpdates.length ? unitUpdates : null,
          p_lease_updates: leaseUpdates.length ? leaseUpdates : null,
        });
        if (error) {
          events.push({ connection_id: connection.id, listing_id: listingId, applied: false, result: "error", detail: { error: error.message } });
          continue;
        }
        applied[result === "delisted" ? "delisted" : result === "relisted" ? "relisted" : "updated"] += 1;
        events.push({
          connection_id: connection.id,
          listing_id: listingId,
          applied: true,
          result,
          detail: { unitUpdates: unitUpdates.length, leaseUpdates: leaseUpdates.length, ...listingUpdates },
        });
      }
    } else {
      events.push({ connection_id: connection.id, listing_id: listingId, applied: false, result: "skipped", detail: dryRun ? { dryRun: true } : {} });
    }

    // Freshness stamp: the availability shown was checked against the PMS
    // today. A dry run verifies nothing — it must not stamp listings.
    if (!dryRun) {
      await supabase.rpc("rpc_pms_mark_verified", {
        p_user_id: SYSTEM_USER_ID,
        p_listing_id: listingId,
        p_source: source,
      });
    }
  }

  await logEvents(events);
  await supabase
    .from("pms_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: dryRun ? "dry_run" : "ok",
      last_sync_error: null,
    })
    .eq("id", connection.id);

  return { connectionId: connection.id, status: dryRun ? "dry_run" : "ok", ...applied };
}
