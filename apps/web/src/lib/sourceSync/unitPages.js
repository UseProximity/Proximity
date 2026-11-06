/*
 * A page per unit (Wyatt, 2026-11-06).
 *
 * A listing's monitor reads one building-level page, which is where new units
 * appear. A unit can also have its own page (listing_unit_pages): the sync
 * reads that page and nothing else, and what it says about the unit wins over
 * the building page. When the page is gone, or no longer shows the unit, the
 * unit is treated as let: it goes into the snapshot as not offered, so the
 * usual sync rules withdraw its leases (unavailable, never deleted), and a
 * later read that finds it again relists them.
 *
 * Landlords (the property's owner) and the team add and remove pages from the
 * Agent tab.
 */
import supabase from "@/lib/supabase";
import { readProperty, DraftFetchError } from "@/lib/sourceImport/read";
import { matchUnits } from "@/lib/sourceImport/apply";
import { classifySourceUrl } from "./classify.js";

// A page that answers with these is gone, not just unreachable today.
const GONE_CODES = new Set(["http_404", "http_410"]);

const unitLabel = (u) => u.name || [u.bedrooms != null ? `${u.bedrooms} bed` : null, u.bathrooms != null ? `${u.bathrooms} bath` : null].filter(Boolean).join(" / ") || "Unit";

/* The live pages for a listing, newest unit order first. */
export async function unitPagesFor(listingId) {
  const { data, error } = await supabase
    .from("listing_unit_pages")
    .select("id, listing_id, unit_id, url, source_kind, enabled, last_status, last_error, last_checked_at, last_seen_at, consecutive_failures, created_at")
    .eq("listing_id", listingId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`unit pages: ${error.message}`);
  return data ?? [];
}

/*
 * Set (or replace) a unit's page. Returns { ok, page } or { ok: false, reason }.
 * Replacing soft-deletes the old row so the history stays.
 */
export async function setUnitPage({ listingId, unitId, rawUrl, userId = null }) {
  const classified = classifySourceUrl(rawUrl);
  if (!classified) return { ok: false, reason: "That is not a web address we can read." };
  const { data: unit } = await supabase.from("listing_units").select("id, listing_id, deleted_at").eq("id", unitId).maybeSingle();
  if (!unit || unit.deleted_at || unit.listing_id !== listingId) return { ok: false, reason: "That unit is not on this listing." };
  const { data: listing } = await supabase.from("listings").select("source_url, lease_type").eq("id", listingId).maybeSingle();
  if (listing?.lease_type === "sublease") return { ok: false, reason: "Sublease listings are not synced." };
  if (!listing?.source_url) return { ok: false, reason: "Add the building's website first. That page is where new units show up." };

  await supabase.from("listing_unit_pages").update({ deleted_at: new Date().toISOString() }).eq("unit_id", unitId).is("deleted_at", null);
  const { data: page, error } = await supabase
    .from("listing_unit_pages")
    .insert({ listing_id: listingId, unit_id: unitId, url: classified.url, source_kind: classified.kind, added_by: userId })
    .select("id, unit_id, url, source_kind, last_status, last_checked_at")
    .single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, page };
}

export async function removeUnitPage({ listingId, unitId }) {
  const { error } = await supabase
    .from("listing_unit_pages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("listing_id", listingId)
    .eq("unit_id", unitId)
    .is("deleted_at", null);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/*
 * Read every unit page of a listing and fold them into the building
 * snapshot. Mutates and returns the snapshot. Never throws: a page that
 * cannot be read today leaves that unit to the building page, as before.
 *
 * Returns { snapshot, pages: [{ unitId, url, status, error }] }.
 */
export async function mergeUnitPages({ listing, snapshot, onStep = () => {} }) {
  const pages = (await unitPagesFor(listing.id).catch(() => [])).filter((p) => p.enabled);
  if (!pages.length) return { snapshot, pages: [] };

  const { data: dbUnits } = await supabase
    .from("listing_units")
    .select("id, name, bedrooms, bathrooms, area, deleted_at")
    .eq("listing_id", listing.id)
    .is("deleted_at", null);
  const unitsById = new Map((dbUnits ?? []).map((u) => [u.id, u]));

  const results = [];
  const pinnedUnits = [];
  for (const p of pages) {
    const db = unitsById.get(p.unit_id);
    if (!db) continue;
    onStep(`Reading the page for ${unitLabel(db)}`);
    let status = "ok";
    let error = null;
    let found = null;
    try {
      const snap = await readProperty({
        pastedUrl: p.url,
        target: { name: listing.title ?? listing.address, address: listing.address, url: p.url, levelUrl: null },
        onlyThisPage: true,
        onStep: () => {},
      });
      const units = snap.units ?? [];
      // The page's unit: the only one, else whichever pairs with this unit.
      if (units.length === 1) found = units[0];
      else if (units.length > 1) {
        const { pairs } = matchUnits(units, [{ ...db, unit_leases: [] }]);
        found = pairs.find((x) => x.db?.id === db.id)?.snap ?? null;
      }
      if (!found) status = "gone";
    } catch (err) {
      const code = err instanceof DraftFetchError ? err.code : null;
      if (code && GONE_CODES.has(code)) status = "gone";
      else {
        status = "failed";
        error = (code ? `fetch failed (${code})` : err?.message ?? "read failed").slice(0, 500);
      }
    }

    if (status === "ok") {
      /*
       * "Available July 20, 2027" with a price is a lease on offer for that
       * date, not a let unit. The reader marks such a unit unavailable (not
       * free today), which would withdraw it; on its own page, a priced offer
       * with a date to come keeps it offered from that date.
       */
      const today = new Date().toISOString().slice(0, 10);
      const offeredLater = (found.offers ?? []).some((o) => o.rent != null && o.availableFrom && o.availableFrom >= today);
      const available = found.available !== false || offeredLater;
      pinnedUnits.push({ ...found, available, name: db.name ?? found.name, key: `unit-page:${db.id}`, pinnedUnitId: db.id, fromUnitPage: p.url });
    } else if (status === "gone") {
      pinnedUnits.push({
        key: `unit-page:${db.id}`,
        name: db.name,
        bedrooms: db.bedrooms == null ? null : Number(db.bedrooms),
        bathrooms: db.bathrooms == null ? null : Number(db.bathrooms),
        area: null,
        floorPlanImageUrl: null,
        available: false,
        photos: [],
        offers: [],
        pinnedUnitId: db.id,
        fromUnitPage: p.url,
        unitPageGone: true,
      });
    }

    const now = new Date().toISOString();
    await supabase
      .from("listing_unit_pages")
      .update({
        last_checked_at: now,
        last_status: status,
        last_error: error,
        ...(status === "ok" ? { last_seen_at: now } : {}),
        consecutive_failures: status === "failed" ? (p.consecutive_failures ?? 0) + 1 : 0,
      })
      .eq("id", p.id);
    results.push({ unitId: db.id, unit: unitLabel(db), url: p.url, status, error });
    console.log(`[unit-pages] ${listing.title ?? listing.address} / ${unitLabel(db)}: ${status}${error ? ` (${error})` : ""}`);
  }

  if (pinnedUnits.length) {
    // The building page's version of a pinned unit gives way to its own page.
    const pinnedIds = new Set(pinnedUnits.map((u) => u.pinnedUnitId));
    const pinnedDb = (dbUnits ?? []).filter((u) => pinnedIds.has(u.id)).map((u) => ({ ...u, unit_leases: [] }));
    const { pairs } = matchUnits(snapshot.units ?? [], pinnedDb);
    const shadowed = new Set(pairs.filter((x) => x.db).map((x) => x.snap));
    snapshot.units = [...(snapshot.units ?? []).filter((u) => !shadowed.has(u)), ...pinnedUnits];
  }
  return { snapshot, pages: results };
}

/*
 * For the Agent tab: every unit on the listing with its page, if it has one.
 */
export async function unitPagesView(listingId) {
  const [{ data: units }, pages] = await Promise.all([
    supabase.from("listing_units").select("id, name, bedrooms, bathrooms, sort_order").eq("listing_id", listingId).is("deleted_at", null).order("sort_order", { ascending: true, nullsFirst: false }),
    unitPagesFor(listingId).catch(() => []),
  ]);
  const byUnit = new Map(pages.map((p) => [p.unit_id, p]));
  return (units ?? []).map((u) => {
    const p = byUnit.get(u.id);
    return {
      unitId: u.id,
      unit: unitLabel(u),
      page: p ? { url: p.url, status: p.last_status, error: p.last_error, lastCheckedAt: p.last_checked_at, lastSeenAt: p.last_seen_at } : null,
    };
  });
}
