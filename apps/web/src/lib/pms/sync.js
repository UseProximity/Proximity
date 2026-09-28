/*
 * The PMS sync engine — one connection per call, PMS as source of truth
 * (ILS-feed semantics):
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
 *   - the mass-delist guard suppresses delists that would hide >20% of the
 *     portfolio, unless a human released the hold (pms_review_queue row set
 *     to 'approved' via the signed link in the digest email; single use)
 *   - price updates are gated by sync_price + a 2% change threshold
 *   - auto_apply=false runs the whole sync as a DRY RUN: every intended
 *     change is logged to pms_sync_events with applied=false, nothing written
 * All writes go through the audit-safe RPCs as the reserved system actor.
 *
 * Called from the daily cron (api/cron/pms-sync) and immediately after a
 * landlord confirms their property choices (api/landlord/pms/confirm), so a
 * new connection is live within seconds of setup, not "tonight".
 */
import supabase from "@/lib/supabase";
import { isLiveLease } from "@/lib/listings/unitAvailability";
import { getConnector } from "./index.js";
import { ingestPmsProperty } from "./ingest.js";
import {
  applyLeasingHorizon,
  leasingHorizonEnd,
  rollUpAvailability,
  rollUpRent,
  rollUpAvailableFrom,
  matchUnitsToListingUnits,
} from "./mapping.js";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
const PRICE_CHANGE_MIN_RATIO = 0.02; // ignore sub-2% price noise
const SWING_RATIO = 0.2;             // hold when >20% of tracked units change…
const SWING_MIN_CHANGES = 3;         // …and at least this many units are affected
const HOLD_APPROVAL_MAX_AGE_MS = 7 * 86400_000; // an approval only counts for a week

async function logEvents(rows) {
  if (rows.length) await supabase.from("pms_sync_events").insert(rows);
}

export async function syncConnection(connection, { dryRun = false } = {}) {
  const source = `pms:${connection.provider}`;
  const connector = getConnector(connection.provider);
  const snapshot = await connector.fetchSnapshot(connection.nango_connection_id, connection.credential_meta ?? null);
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
  // Property-level exclusion is ONLY the marker row (external_unit_id NULL,
  // include=false). Stale rejected unit rows must not count: a landlord who
  // excluded then re-included a property would otherwise have it silently
  // skipped forever by any unit row the re-confirm didn't rewrite.
  const excludedProperties = new Set(
    (allLinks ?? [])
      .filter((l) => !l.include && l.external_unit_id == null)
      .map((l) => l.external_property_id)
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

  // A recently approved hold (via the digest email's release link) lets ONE
  // run through the swing/mass-delist guards; it is consumed after use. Also
  // honored in dry-run so a held observe-only connection can record what it
  // would have done (dry-run still writes nothing).
  const approvedHold = await recentApprovedHold(connection.id);

  // ±20% swing guard: too much portfolio change at once -> hold everything.
  const changes = missing.length + fresh.length;
  if (
    !approvedHold &&
    unitLinks.length > 0 &&
    changes >= SWING_MIN_CHANGES &&
    changes / unitLinks.length > SWING_RATIO
  ) {
    await openHold(connection.id, { tracked: unitLinks.length, missing: missing.length, new: fresh.length });
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
  // Two passes: decide first (write nothing), then apply — so a mass delist can
  // be caught and held BEFORE anything is hidden. A degraded pull (some
  // sub-fetch failed) is trusted to relist/update but NEVER to delist: a hiccup
  // in the leases endpoint must not hide a pre-leased building whose occupancy
  // only looked "unavailable" because its move-in date went missing.
  const degraded = snapshot.errors.length > 0;

  const byListing = new Map();
  for (const l of unitLinks) {
    if (!byListing.has(l.listing_id)) byListing.set(l.listing_id, []);
    byListing.get(l.listing_id).push(l);
  }

  // Pass 1 — compute each listing's intended change without writing.
  const decisions = [];
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
      .select("id, unit_leases(id, rent, available_from, is_active, unavailable, owner_id)")
      .eq("listing_id", listingId)
      .is("deleted_at", null);
    const typeById = new Map((typeRows ?? []).map((t) => [t.id, t]));

    const unitUpdates = [];
    const leaseUpdates = [];
    for (const [typeId, group] of byType) {
      const current = typeById.get(typeId);
      if (!current) continue;
      // The lease this connection may actually write to (see rpc_pms_apply's
      // p_owner_id scope) — comparing against another landlord's price would
      // trigger phantom "price changed" updates on every sync.
      const ownerId = connection.user_id ?? null;
      const mine = (current.unit_leases ?? []).filter(
        (le) => le.is_active && (le.owner_id == null || ownerId == null || le.owner_id === ownerId)
      );

      /*
       * Occupancy from the PMS lands on THIS landlord's offerings, not on the
       * unit: units no longer carry availability of their own. Scoping to
       * `mine` matters more here than it does for price — a sync must never
       * withdraw a competitor's offering on a unit it happens to share.
       *
       * A type with no offering of ours has nothing to flip. It shows as
       * available-with-unknown-terms either way, so there is no silent hide.
       */
      const nextAvailable = rollUpAvailability(group);
      if (nextAvailable != null && mine.length) {
        const currentlyAvailable = mine.some(isLiveLease);
        if (nextAvailable !== currentlyAvailable) {
          unitUpdates.push({
            id: typeId,
            available: nextAvailable,
            lease_ids: (nextAvailable
              ? mine.filter((le) => le.unavailable)
              : mine.filter(isLiveLease)
            ).map((le) => le.id),
          });
        }
      }
      const activeLease = (current.unit_leases ?? []).find(
        (le) =>
          le.is_active &&
          !le.unavailable &&
          (le.owner_id == null || ownerId == null || le.owner_id === ownerId)
      );
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
    decisions.push({
      listingId,
      unitUpdates,
      leaseUpdates,
      listingUpdates,
      // Only stamp "verified" when we actually observed a known state.
      learnedSomething: knownStates.length > 0,
    });
  }

  // Mass-delist guard. The ±20% swing guard above only counts units that
  // entered/left the snapshot; a PMS glitch (or a degraded pull) can flip a
  // whole portfolio to occupied with every unit still present, which it would
  // miss. Count intended delists; if they clear the swing threshold, or the
  // pull was degraded, suppress ALL delists this run and hold for review —
  // relists/updates/creates still apply. Never suppress in dry-run (there we
  // WANT the intended delist logged; nothing is written anyway). A recent
  // human approval (digest email link) releases the mass-delist hold for one
  // run; a degraded pull is never released — missing data can't be approved
  // into correctness.
  const intendedDelists = decisions.filter((d) => d.listingUpdates.unavailable === true).length;
  const massDelist =
    intendedDelists >= SWING_MIN_CHANGES &&
    intendedDelists / Math.max(decisions.length, 1) > SWING_RATIO;
  const suppressDelists = !dryRun && (degraded || (massDelist && !approvedHold));

  if (suppressDelists && intendedDelists > 0) {
    await openHold(connection.id, { intendedDelists, totalListings: decisions.length, degraded, massDelist });
    events.push({
      connection_id: connection.id,
      result: "held",
      applied: false,
      detail: { kind: "delists_suppressed", intendedDelists, totalListings: decisions.length, degraded, massDelist },
    });
  }

  // Pass 2 — apply.
  for (const d of decisions) {
    const { listingId, unitUpdates, leaseUpdates, learnedSomething } = d;
    let listingUpdates = d.listingUpdates;
    // Suppressed delist: drop only the unavailable=true write, keep the rest.
    if (suppressDelists && listingUpdates.unavailable === true) {
      // eslint-disable-next-line no-unused-vars
      const { unavailable, ...rest } = listingUpdates;
      listingUpdates = rest;
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
        applied[result] += 1;
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
          // Scope lease writes to THIS landlord's offerings. Several landlords
          // can now offer the same unit, and without this the sync repriced
          // whichever of them happened to be active — including a competitor's.
          p_owner_id: connection.user_id ?? null,
        });
        if (error) {
          events.push({ connection_id: connection.id, listing_id: listingId, applied: false, result: "error", detail: { error: error.message } });
          continue;
        }
        applied[result] += 1;
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
    // today. Skip in dry-run, and skip when nothing was actually known (an
    // all-unknown listing verified nothing).
    if (!dryRun && learnedSomething) {
      await supabase.rpc("rpc_pms_mark_verified", {
        p_user_id: SYSTEM_USER_ID,
        p_listing_id: listingId,
        p_source: source,
      });
    }
  }

  // An approval is single-use: once a run has actually gone through on its
  // strength, mark it consumed so a later glitch can't ride the same approval.
  // A degraded pull still suppresses delists regardless of approval — in that
  // case the approval was NOT used, so it survives for the next healthy run.
  if (approvedHold && !dryRun && !suppressDelists) {
    await supabase
      .from("pms_review_queue")
      .update({ status: "resolved_kept" })
      .eq("id", approvedHold.id);
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

  return {
    connectionId: connection.id,
    status: dryRun ? "dry_run" : "ok",
    ...applied,
    heldDelists: suppressDelists && intendedDelists > 0 ? intendedDelists : 0,
  };
}

// One open swing_guard_hold row per connection (deduped); the digest email
// links to its release page.
async function openHold(connectionId, detail) {
  const { data: openRow } = await supabase
    .from("pms_review_queue")
    .select("id")
    .eq("connection_id", connectionId)
    .eq("reason", "swing_guard_hold")
    .eq("status", "open")
    .maybeSingle();
  if (!openRow) {
    await supabase.from("pms_review_queue").insert({
      connection_id: connectionId,
      reason: "swing_guard_hold",
      detail,
    });
  }
}

async function recentApprovedHold(connectionId) {
  const { data } = await supabase
    .from("pms_review_queue")
    .select("id, resolved_at")
    .eq("connection_id", connectionId)
    .eq("reason", "swing_guard_hold")
    .eq("status", "approved")
    .order("resolved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.resolved_at) return null;
  const age = Date.now() - new Date(data.resolved_at).getTime();
  return age >= 0 && age < HOLD_APPROVAL_MAX_AGE_MS ? data : null;
}
