export const dynamic = "force-dynamic";
export const maxDuration = 120;
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isApiProvider, getConnector } from "@/lib/pms/index.js";
import { ingestPmsProperty } from "@/lib/pms/ingest.js";
import { matchUnitsToListingUnits } from "@/lib/pms/mapping.js";

async function requireLandlordOrSuper() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!["landlord", "super"].includes(session.user.role)) return null;
  return session;
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
 *
 * Re-runs are first-class (demo re-plays, reconnects, changed minds):
 *   - "ingest" on a property already linked to a live listing REUSES it,
 *     never duplicates.
 *   - "exclude" (and re-"link"ing elsewhere) releases any listing an earlier
 *     confirm attached: a review-less listing this connection ingested is
 *     soft-deleted; anything with reviews, or that the landlord created
 *     manually, is only detached and stays live. Reviews are never destroyed.
 */

// Release a listing a superseded decision left behind. Only touches listings
// owned by THIS connection; preserves anything carrying reviews.
async function releaseListing({ listingId, connection, actorId }) {
  if (!listingId) return;
  const { data: listing } = await supabase
    .from("listings")
    .select("id, pms_connection_id, deleted_at")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing || listing.deleted_at || listing.pms_connection_id !== connection.id) return;

  const { count: reviewCount, error: reviewErr } = await supabase
    .from("listing_reviews")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", listingId)
    .is("deleted_at", null);
  const { data: ingestLink } = await supabase
    .from("pms_links")
    .select("id")
    .eq("connection_id", connection.id)
    .eq("listing_id", listingId)
    .eq("origin", "ingested")
    .limit(1)
    .maybeSingle();

  // Fail CLOSED on the review check: if the count errored or is unknown, treat
  // the listing as if it has reviews and only detach it. Never let a failed
  // query be the reason a review-bearing listing gets deleted.
  const hasReviews = Boolean(reviewErr) || reviewCount == null || reviewCount > 0;
  const updates =
    !hasReviews && ingestLink
      ? { deleted_at: new Date().toISOString(), pms_connection_id: null }
      : { pms_connection_id: null };
  await supabase.rpc("rpc_pms_apply", {
    p_user_id: actorId,
    p_listing_id: listingId,
    p_listing_updates: updates,
  });
}

// Listing ids this property's existing links point at (from earlier confirms).
async function linkedListingIds(connectionId, externalPropertyId) {
  const { data } = await supabase
    .from("pms_links")
    .select("listing_id")
    .eq("connection_id", connectionId)
    .eq("external_property_id", externalPropertyId)
    .not("listing_id", "is", null);
  return [...new Set((data ?? []).map((l) => l.listing_id))];
}
export async function POST(req) {
  const session = await requireLandlordOrSuper();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { connectionId, decisions } = await req.json().catch(() => ({}));
  if (!connectionId || !Array.isArray(decisions) || decisions.length === 0) {
    return NextResponse.json({ error: "connectionId and decisions are required" }, { status: 400 });
  }

  const { data: connection } = await supabase
    .from("pms_connections")
    .select("id, user_id, provider, nango_connection_id, credential_meta, status")
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
  const snapshot = await connector.fetchSnapshot(connection.nango_connection_id, connection.credential_meta ?? null);
  const byExternalId = new Map(snapshot.properties.map((p) => [p.externalPropertyId, p]));
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
        // Capture what earlier confirms attached before rejecting the links,
        // so a stale listing from a previous run can be released too.
        const previous = await linkedListingIds(connection.id, prop.externalPropertyId);
        await supabase
          .from("pms_links")
          .update({ include: false, link_status: "rejected" })
          .eq("connection_id", connection.id)
          .eq("external_property_id", prop.externalPropertyId);
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
        for (const lid of previous) {
          await releaseListing({ listingId: lid, connection, actorId: session.user.id });
        }
        results.push({ externalPropertyId, action, ok: true });
        continue;
      }

      if (action === "link") {
        if (!listingId || !ownedIds.has(listingId)) {
          results.push({ externalPropertyId, action, error: "listingId missing or not yours" });
          continue;
        }
        // Don't attach to a soft-deleted listing of theirs.
        const { data: target } = await supabase
          .from("listings")
          .select("id, deleted_at")
          .eq("id", listingId)
          .maybeSingle();
        if (!target || target.deleted_at) {
          results.push({ externalPropertyId, action, error: "That listing no longer exists" });
          continue;
        }
        // Capture what this property was attached to BEFORE the upsert loop
        // rewrites those same link rows' listing_id — otherwise a property
        // previously ingested and now re-linked elsewhere would orphan its
        // old listing (a frozen duplicate shown to students forever).
        const previous = await linkedListingIds(connection.id, prop.externalPropertyId);

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
        // Release any DIFFERENT listing this property was attached to before
        // (e.g. auto-ingested on a previous run) so it can't linger as a dupe.
        for (const lid of previous) {
          if (lid !== listingId) {
            await releaseListing({ listingId: lid, connection, actorId: session.user.id });
          }
        }
        results.push({ externalPropertyId, action, listingId, ok: true });
        continue;
      }

      if (action === "ingest") {
        // Re-run safety: if this property already has a confirmed link to a
        // live listing, reuse it instead of creating a duplicate.
        const { data: priorLink } = await supabase
          .from("pms_links")
          .select("listing_id")
          .eq("connection_id", connection.id)
          .eq("external_property_id", prop.externalPropertyId)
          .eq("link_status", "confirmed")
          .eq("include", true)
          .not("listing_id", "is", null)
          .limit(1)
          .maybeSingle();
        if (priorLink?.listing_id) {
          const { data: prior } = await supabase
            .from("listings")
            .select("id, deleted_at")
            .eq("id", priorLink.listing_id)
            .maybeSingle();
          if (prior && !prior.deleted_at) {
            results.push({ externalPropertyId, action, listingId: prior.id, ok: true, reused: true });
            continue;
          }
        }

        const { listingId: newListingId, unitMap } = await ingestPmsProperty({
          property: prop,
          connection,
          ownerId: session.user.id,
          contactEmail: session.user.email ?? null,
          contactName: session.user.name ?? null,
        });

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
