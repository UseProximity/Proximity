/*
 * Lay a snapshot over a listing.
 *
 * The one writer for both halves of the feature. A first import applies a
 * snapshot to an empty draft; the weekly sync applies a fresh snapshot to a
 * live listing. The rules (Wyatt, 2026-10-20) are the same either way, the
 * difference is only what is already there:
 *
 *   - A unit matches by name, then by layout and size. A unit the site has
 *     and the listing lacks is added (as a draft on a live listing). A unit the
 *     listing has and the site dropped is flagged, never removed.
 *   - A lease is one price on one unit. The same price on the site updates
 *     that lease's details (lengths, date, apartments). A price the site no
 *     longer offers makes its lease unavailable. A new price is a new lease.
 *     A lease's price is never changed and a lease is never deleted.
 *   - Bed, bath and size changes to a unit are flagged, not applied. A lease
 *     coming back from unavailable is flagged unless it was the sync that
 *     withdrew it.
 *   - More than a fifth of the listing's leases changing at once holds the
 *     whole run for a person. So does a snapshot the reader was not sure of.
 *   - Only the listing owner's own leases are touched. Other landlords'
 *     offerings on the same building are never read or written.
 *
 * Every decision is a change record. Applied or held, it is written to
 * listing_source_events with enough detail to replay it later (applyEvents),
 * which is what the "proposed changes" review and the digest email read.
 */
import supabase from "@/lib/supabase";
import { unitNameKey, apartmentsLabel, cleanUnitName } from "@/utils/unitName";
import { nextUnitSortOrder } from "@/lib/listings/unitNames";
import { copyRemoteImage, copyRemoteImages, addressSlug } from "./assets.js";
import { judgeChange } from "./model.js";
import { summarize } from "./snapshot.js";
import { HELD_FOR_BILLING_MESSAGE, checkListingGate, gateMessage } from "@/lib/billing/listingGate";
import { sameSite } from "@/lib/listingDraft/fetchSite";

const CHURN_FRACTION = 0.2;
const CHURN_MIN_LEASES = 5;
const REJECTED_QUIET_DAYS = 30;
const MAX_LEASES_PER_UNIT = 40;

// ---------------------------------------------------------------- state

export async function loadListingState(listingId) {
  const { data: row, error } = await supabase
    .from("listings")
    .select(
      `id, title, address, description, furnished, home_type_id, lease_type, published_at, deleted_at,
       contact_name, contact_email, contact_phone, source_url,
       listing_landlords(user_id, is_primary),
       listing_units(id, name, bedrooms, bathrooms, area, floor_plan_image_url, published_at, deleted_at, sort_order,
         unit_leases(id, rent, rent_is_per_person, lease_term_months, available_from, unavailable, is_active, owner_id, description, deleted_at, published_at, contact_email)),
       listing_images(id, url, unit_id, sort_order, source),
       listing_amenities(*), listing_utilities(*),
       listing_custom_amenities(id, label),
       listing_concessions(id, description, active, last_verified_source)`
    )
    .eq("id", listingId)
    .maybeSingle();
  if (error) throw new Error(`load listing: ${error.message}`);
  if (!row || row.deleted_at) return null;
  // Units a person removed, by name: a sync must not quietly put them back.
  row.removedUnitNames = (row.listing_units ?? []).filter((u) => u.deleted_at && u.name).map((u) => u.name);
  row.listing_units = (row.listing_units ?? []).filter((u) => !u.deleted_at);
  for (const u of row.listing_units) u.unit_leases = (u.unit_leases ?? []).filter((l) => !l.deleted_at);
  return row;
}

const ownerIdsOf = (state) => (state.listing_landlords ?? []).map((l) => l.user_id);
const primaryOwner = (state) => (state.listing_landlords ?? []).find((l) => l.is_primary)?.user_id ?? ownerIdsOf(state)[0] ?? null;
const isMine = (lease, ownerIds) => !lease.owner_id || ownerIds.includes(lease.owner_id);

// ---------------------------------------------------------------- matching

const norm = (s) => String(s ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();

/*
 * Pair the snapshot's units with the listing's. Name first; then, among units
 * of the same layout, the closest size within 5%; then the only unit of that
 * layout on each side. Returns [{ snap, db }] with db null for new units, plus
 * the listing's units nothing claimed.
 */
export function matchUnits(snapUnits, dbUnits) {
  const pool = dbUnits.map((u) => ({ u, used: false }));
  /*
   * Names first, across every plan, then layout for what is left. One plan
   * at a time, 212 Clayton's "09" (781 sq ft) came before "12" and took the
   * listing's existing "12" (786 sq ft) by size; the real 12 then looked new.
   */
  const byName = new Map();
  // A unit read off its own page (listing_unit_pages) already knows which
  // unit it is.
  for (const s of snapUnits) {
    if (!s.pinnedUnitId) continue;
    const hit = pool.find((p) => !p.used && p.u.id === s.pinnedUnitId);
    if (hit) {
      hit.used = true;
      byName.set(s, hit.u);
    }
  }
  for (const s of snapUnits) {
    if (byName.has(s) || s.pinnedUnitId) continue;
    const sName = norm(s.name);
    const hit = sName ? pool.find((p) => !p.used && norm(p.u.name) === sName) : null;
    if (hit) {
      hit.used = true;
      byName.set(s, hit.u);
    }
  }
  const pairs = [];
  for (const s of snapUnits) {
    if (byName.has(s)) {
      pairs.push({ snap: s, db: byName.get(s) });
      continue;
    }
    // Pinned to a unit that is no longer on the listing: nothing to do.
    if (s.pinnedUnitId) continue;
    const sName = norm(s.name);
    let hit = null;
    if (s.bedrooms != null && s.bathrooms != null) {
      const same = pool.filter((p) => !p.used && Number(p.u.bedrooms) === Number(s.bedrooms) && Number(p.u.bathrooms) === Number(s.bathrooms));
      const gap = (p) => (Number(p.u.area) > 0 && s.area > 0 ? Math.abs(Number(p.u.area) - s.area) / Math.max(Number(p.u.area), s.area) : Infinity);
      hit = same.filter((p) => gap(p) <= 0.05).sort((a, b) => gap(a) - gap(b))[0] ?? null;
      if (!hit) {
        const onlyOne =
          same.length === 1 &&
          snapUnits.filter((x) => Number(x.bedrooms) === Number(s.bedrooms) && Number(x.bathrooms) === Number(s.bathrooms)).length === 1;
        // Only when neither side has a name to disagree on.
        if (onlyOne && !sName && !norm(same[0].u.name)) hit = same[0];
      }
    }
    if (hit) hit.used = true;
    pairs.push({ snap: s, db: hit?.u ?? null });
  }
  return { pairs, unmatched: pool.filter((p) => !p.used).map((p) => p.u) };
}

const leaseKey = (rent, perPerson) => (rent == null ? "none" : `${Math.round(Number(rent))}:${perPerson ? "pp" : "whole"}`);
const sameTerms = (a, b) => JSON.stringify([...(a ?? [])].map(Number).sort((x, y) => x - y)) === JSON.stringify([...(b ?? [])].map(Number).sort((x, y) => x - y));

// ---------------------------------------------------------------- the listing gate

/*
 * A change that puts a lease in front of students: a new published lease, or
 * a withdrawn one coming back. Those pass the same listing gate a landlord's
 * publish does (payment method, commission agreement, coverage), Wyatt
 * 2026-11-06; until then they wait for the landlord.
 */
export function putsLeaseLive(c) {
  const d = c.detail ?? {};
  if (c.kind === "lease_new") return !d.draft;
  if (c.kind === "unit_relisted") return true;
  return d.op === "lease_update" && d.patch?.unavailable === false;
}

/* The gate for one owner and listing. Fails closed: an error holds the change. */
async function gateFor(userId, listingId) {
  if (!userId) return { allowed: true };
  try {
    const g = await checkListingGate(supabase, userId, { listingIds: [listingId] });
    return { allowed: !!g.allowed, message: g.allowed ? null : gateMessage(g.missing ?? [], g.uncovered ?? []) };
  } catch (err) {
    console.error(`[source-import] listing gate for ${listingId}: ${err?.message}`);
    return { allowed: false, message: "Could not check the listing gate; held for the landlord." };
  }
}

// ---------------------------------------------------------------- planning

/*
 * Everything the snapshot would change, as replayable change records. Pure:
 * reads the loaded state, writes nothing.
 *
 * mode "import" fills a fresh draft; mode "sync" reconciles a listing that
 * already has data. The difference shows up in a few places: a sync adds new
 * units as drafts and leaves prose alone, an import writes everything.
 */
/*
 * Unit tabs in layout order: studios first, then bedrooms, bathrooms, size,
 * then name. The same order as the editor's "Sort by beds and baths".
 */
const layoutCompare = (a, b) =>
  (a.bedrooms ?? 99) - (b.bedrooms ?? 99) ||
  (Number(a.bathrooms) || 99) - (Number(b.bathrooms) || 99) ||
  (Number(a.area) || 0) - (Number(b.area) || 0) ||
  String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { numeric: true });

async function unitsInOrder(listingId) {
  const { data } = await supabase.from("listing_units").select("id, name, bedrooms, bathrooms, area, sort_order").eq("listing_id", listingId).is("deleted_at", null).order("sort_order", { ascending: true });
  return data ?? [];
}

/* Whether the listing's tabs are already in layout order (nobody rearranged them). */
async function inLayoutOrder(listingId) {
  const units = await unitsInOrder(listingId);
  return units.map((u) => u.id).join() === [...units].sort(layoutCompare).map((u) => u.id).join();
}

/* Put the listing's units in layout order. */
export async function sortUnitsByLayout(listingId) {
  const units = await unitsInOrder(listingId);
  const sorted = [...units].sort(layoutCompare);
  await Promise.all(
    sorted.map((u, i) => (u.sort_order === i ? null : supabase.from("listing_units").update({ sort_order: i }).eq("id", u.id).eq("listing_id", listingId))).filter(Boolean)
  );
}

/* Delete the property's cover when it is a Street View placeholder. */
async function dropStreetViewCover(listingId) {
  const { data: cover } = await supabase
    .from("listing_images")
    .select("id, source")
    .eq("listing_id", listingId)
    .is("unit_id", null)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (cover?.source !== "street_view") return false;
  const { error } = await supabase.from("listing_images").delete().eq("id", cover.id);
  if (error) {
    console.error("[source-import] street view cover not removed:", error.message);
    return false;
  }
  return true;
}

export function planChanges({ state, snapshot, mode, ownerIds, withdrawnBySync = new Set(), takeover = null }) {
  const changes = [];
  const push = (c) => changes.push({ auto: true, ...c });
  const p = snapshot.property;

  // ---- property fields
  const patch = {};
  if (mode === "import") {
    if (p.name && !state.title) patch.title = p.name;
    if (p.description && !state.description?.trim()) patch.description = p.description;
    if (p.furnished != null) patch.furnished = p.furnished;
    for (const [k, v] of [["contact_name", p.contactName], ["contact_email", p.contactEmail], ["contact_phone", p.contactPhone]]) {
      if (v && !state[k]) patch[k] = v;
    }
    // A fuller address from the site than the picker had, same street number.
    const num = (a) => String(a ?? "").match(/^\s*(\d+)/)?.[1];
    if (p.address && num(p.address) && (!num(state.address) || (num(p.address) === num(state.address) && p.address.length > (state.address ?? "").length + 4))) {
      patch.address = p.address;
    }
  } else if (takeover) {
    /*
     * A building Proximity listed with nobody behind it (from student
     * reviews), just claimed. What it had was a stub: the landlord's own
     * website writes the description, and the landlord's contact replaces
     * whatever the stub carried. Units and leases stay proposed changes.
     */
    if (p.description) patch.description = p.description;
    for (const [k, v] of [["contact_name", takeover.contact?.name], ["contact_email", takeover.contact?.email], ["contact_phone", takeover.contact?.phone]]) {
      if (v && state[k] !== v) patch[k] = v;
    }
  } else if (p.description && !state.description?.trim()) {
    patch.description = p.description;
  }
  const amenities = mode === "import" ? p.amenities : [];
  const utilities = mode === "import" ? p.utilities : [];
  const have = new Set((state.listing_custom_amenities ?? []).map((a) => a.label.toLowerCase()));
  const customAmenities = mode === "import" ? p.customAmenities.filter((a) => !have.has(a.toLowerCase())) : [];
  // A special reworded between reads ("Two Months FREE!" one day, "Receive
  // 2 months free" the next) is the same special, not a new one and a gone one.
  const activeConcessions = (state.listing_concessions ?? []).filter((c) => c.active);
  const concessions = p.concessions.filter((c) => !activeConcessions.some((h) => sameSpecial(h.description, c)));
  const staleConcessions =
    mode === "sync"
      ? activeConcessions
          .filter((c) => c.last_verified_source === "source-sync" && !p.concessions.some((n) => sameSpecial(n, c.description)))
          .map((c) => c.id)
      : [];
  if (Object.keys(patch).length || amenities.length || utilities.length || customAmenities.length || concessions.length || staleConcessions.length) {
    push({
      kind: "property_updated",
      field: Object.keys(patch).join(",") || "extras",
      old: null,
      new: patch,
      detail: { op: "property_update", patch, amenities, utilities, customAmenities, concessions, staleConcessions, homeType: mode === "import" ? p.homeType : null },
    });
  }

  // ---- property photos: only when the listing has none of its own
  const propertyPhotoCount = (state.listing_images ?? []).filter((i) => !i.unit_id && i.source !== "street_view").length;
  if (p.photos.length && propertyPhotoCount === 0) {
    push({ kind: "photos_added", field: "property", old: 0, new: p.photos.length, detail: { op: "photos_add", unitId: null, urls: p.photos.map((x) => x.url) } });
  }

  // ---- units and leases
  // Studios first, then by bedrooms, bathrooms and size: the order students
  // and landlords expect, whatever order the site listed them in.
  const ordered = [...snapshot.units].sort(
    (a, b) => (a.bedrooms ?? 99) - (b.bedrooms ?? 99) || (a.bathrooms ?? 99) - (b.bathrooms ?? 99) || (a.area ?? 0) - (b.area ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? ""))
  );
  const { pairs, unmatched } = matchUnits(ordered, state.listing_units);
  for (const { snap, db } of pairs) {
    const label = snap.name ?? `${snap.bedrooms ?? "?"} bed / ${snap.bathrooms ?? "?"} bath`;
    if (!db) {
      push({
        kind: "unit_new",
        unitKey: snap.key,
        field: "unit",
        old: null,
        new: { name: snap.name, bedrooms: snap.bedrooms, bathrooms: snap.bathrooms, area: snap.area, offers: snap.offers.length },
        detail: {
          op: "unit_insert",
          label,
          unit: { name: snap.name, bedrooms: snap.bedrooms, bathrooms: snap.bathrooms, area: snap.area, floorPlanImageUrl: snap.floorPlanImageUrl },
          offers: snap.offers,
          available: snap.available,
          photos: snap.photos,
          draft: mode === "sync",
        },
      });
      continue;
    }

    // Specs: an import fills blanks; a sync only flags a disagreement.
    const specPatch = {};
    const specDiff = {};
    for (const f of ["bedrooms", "bathrooms", "area"]) {
      const sv = snap[f];
      const dv = db[f] == null ? null : Number(db[f]);
      if (sv == null) continue;
      if (dv == null) specPatch[f] = sv;
      else if (Number(sv) !== dv) specDiff[f] = { old: dv, new: sv };
    }
    if (snap.floorPlanImageUrl && !db.floor_plan_image_url) specPatch.floorPlanImageUrl = snap.floorPlanImageUrl;
    // Paired by layout and size, but the site calls it something else: say so.
    if (snap.name && db.name && norm(snap.name) !== norm(db.name)) {
      specDiff.name = { old: db.name, new: snap.name };
    }
    if (Object.keys(specPatch).length) {
      push({ kind: "unit_updated", unitKey: snap.key, unitId: db.id, field: Object.keys(specPatch).join(","), old: null, new: specPatch, detail: { op: "unit_update", unitId: db.id, label, patch: specPatch } });
    }
    if (Object.keys(specDiff).length) {
      const patchFromSite = Object.fromEntries(Object.entries(specDiff).map(([k, v]) => [k, v.new]));
      push({
        kind: "spec_mismatch",
        unitKey: snap.key,
        unitId: db.id,
        field: Object.keys(specDiff).join(","),
        old: Object.fromEntries(Object.entries(specDiff).map(([k, v]) => [k, v.old])),
        new: patchFromSite,
        auto: false,
        judge: true,
        detail: { op: "unit_update", unitId: db.id, label, patch: patchFromSite },
      });
    }
    const unitPhotoCount = (state.listing_images ?? []).filter((i) => i.unit_id === db.id).length;
    if (snap.photos.length && unitPhotoCount === 0) {
      push({ kind: "photos_added", unitKey: snap.key, unitId: db.id, field: "unit", old: 0, new: snap.photos.length, detail: { op: "photos_add", unitId: db.id, label, urls: snap.photos } });
    }

    // Leases: one per price. The site's offers against the owner's leases.
    const mine = db.unit_leases.filter((l) => isMine(l, ownerIds));
    const byKey = new Map();
    for (const l of mine) {
      const k = leaseKey(l.rent, l.rent_is_per_person);
      // Two leases at one price is the duplicate this writer exists to stop;
      // the live one, else the first, is the one the site's offer lands on.
      if (!byKey.has(k) || (byKey.get(k).unavailable && !l.unavailable)) byKey.set(k, l);
    }
    const offers = snap.available ? snap.offers : [];
    const seen = new Set();
    const unmatchedOffers = [];
    for (const o of offers) {
      const k = leaseKey(o.rent, o.rentIsPerPerson);
      seen.add(k);
      const l = byKey.get(k);
      if (!l) {
        if (o.rent == null && mine.some((x) => x.rent == null)) continue;
        unmatchedOffers.push(o);
        continue;
      }
      planLeaseUpdate(o, l);
    }
    /*
     * A price change edits the lease in place (Wyatt, 2026-10-26): on a sync,
     * an offer at a price the unit does not have and a live lease at a price
     * the site no longer shows are the same lease repriced, paired cheapest
     * to cheapest. Only what is left over is a new lease or a withdrawal, so
     * a plan that gains a second price gets a second lease and one that loses
     * a price loses one. An import still creates one lease per price.
     */
    const goneLeases = mine.filter((l) => !l.unavailable && !seen.has(leaseKey(l.rent, l.rent_is_per_person)));
    if (mode === "sync") {
      const byRent = (a, b) => (a.rent ?? 0) - (b.rent ?? 0);
      const pairsOffers = unmatchedOffers.filter((o) => o.rent != null).sort(byRent);
      const pairsLeases = goneLeases.filter((l) => l.rent != null).sort(byRent);
      while (pairsOffers.length && pairsLeases.length) {
        const o = pairsOffers.shift();
        const l = pairsLeases.shift();
        unmatchedOffers.splice(unmatchedOffers.indexOf(o), 1);
        goneLeases.splice(goneLeases.indexOf(l), 1);
        seen.add(leaseKey(l.rent, l.rent_is_per_person));
        planLeaseUpdate(o, l, { rent: o.rent, rent_is_per_person: o.rentIsPerPerson ?? l.rent_is_per_person });
      }
    }
    for (const o of unmatchedOffers) {
      push({
        kind: "lease_new",
        unitKey: snap.key,
        unitId: db.id,
        field: "rent",
        old: null,
        new: { rent: o.rent, rentIsPerPerson: o.rentIsPerPerson, leaseTermMonths: o.leaseTermMonths, availableFrom: o.availableFrom, apartments: o.apartments },
        detail: { op: "lease_insert", unitId: db.id, label, offer: o, draft: false },
      });
    }

    function planLeaseUpdate(o, l, repriced = null) {
      const apartments = leaseBlurb(o);
      const lp = { ...(repriced ?? {}) };
      const diff = {};
      if (repriced) diff.rent = { old: l.rent, new: o.rent };
      if (o.leaseTermMonths.length && !sameTerms(o.leaseTermMonths, l.lease_term_months)) {
        lp.lease_term_months = o.leaseTermMonths;
        diff.leaseTermMonths = { old: l.lease_term_months ?? [], new: o.leaseTermMonths };
      }
      // A date that has arrived means available now: a site that says
      // "today" one day and "now" the next has not changed anything.
      if (moveInKey(o.availableFrom) !== moveInKey(l.available_from)) {
        lp.available_from = o.availableFrom;
        diff.availableFrom = { old: l.available_from ?? null, new: o.availableFrom };
      }
      if (apartments && apartments !== l.description) {
        lp.description = apartments;
        diff.apartments = { old: l.description ?? null, new: apartments };
      }
      if (l.unavailable) {
        // Back on the site. Automatic only when it was the sync that took it down.
        push({
          kind: "unit_relisted",
          unitKey: snap.key,
          unitId: db.id,
          leaseId: l.id,
          field: "unavailable",
          old: true,
          new: false,
          auto: withdrawnBySync.has(l.id) || mode === "import",
          judge: !withdrawnBySync.has(l.id),
          detail: { op: "lease_update", leaseId: l.id, label, patch: { ...lp, unavailable: false, is_active: true } },
        });
      } else if (Object.keys(lp).length) {
        push({ kind: repriced ? "rent_change" : "lease_updated", unitKey: snap.key, unitId: db.id, leaseId: l.id, field: Object.keys(diff).join(","), old: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.old])), new: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.new])), detail: { op: "lease_update", leaseId: l.id, label, patch: lp } });
      }
    }
    // A price the site no longer offers (or a unit it stopped offering).
    for (const l of goneLeases) {
      if (mode === "import") continue;
      push({ kind: "lease_withdrawn", unitKey: snap.key, unitId: db.id, leaseId: l.id, field: "unavailable", old: false, new: true, detail: { op: "lease_withdraw", leaseId: l.id, label, rent: l.rent } });
    }
  }
  if (mode === "sync") {
    for (const u of unmatched) {
      if (!u.unit_leases.some((l) => isMine(l, ownerIds) && !l.unavailable)) continue;
      push({ kind: "missing_unit", unitId: u.id, field: "unit", old: { name: u.name, bedrooms: u.bedrooms, bathrooms: u.bathrooms }, new: null, auto: false, detail: { op: "none", unitId: u.id, label: u.name ?? `${u.bedrooms} bed / ${u.bathrooms} bath` } });
    }
  }
  // Which changes came from a unit's own page, and whether that page is gone
  // (the unit is let: its leases are withdrawn, never deleted).
  const pinned = new Map((snapshot.units ?? []).filter((u) => u.pinnedUnitId).map((u) => [u.pinnedUnitId, u]));
  if (pinned.size) {
    for (const c of changes) {
      const u = pinned.get(c.unitId ?? c.detail?.unitId);
      if (!u) continue;
      c.detail = { ...c.detail, fromUnitPage: u.fromUnitPage, ...(u.unitPageGone ? { unitPageGone: true } : {}) };
      if (u.unitPageGone && c.kind === "lease_withdrawn") c.note = "the unit's own page is gone, so it is treated as let";
    }
  }
  return changes;
}

// ---------------------------------------------------------------- executing

async function homeTypeIdFor(label) {
  if (!label) return null;
  const { data } = await supabase.from("home_types").select("id").ilike("label", label).maybeSingle();
  return data?.id ?? null;
}

const AMENITY_COLS = ["air_conditioning", "dishwasher", "gym", "laundry", "mailroom", "microwave", "oven", "parking", "pets_allowed", "pool", "refrigerator", "rooftop", "storage", "stove", "study_room"];
const UTILITY_COLS = ["electric", "gas", "heat", "water", "internet", "trash", "cable", "sewer", "cooling"];

async function insertImages({ state, userId, unitId, urls, slug }) {
  const copied = await copyRemoteImages(urls, { kind: unitId ? "unit-photo" : "photo", slug });
  if (!copied.length) return 0;
  const { data: last } = await supabase.from("listing_images").select("sort_order").eq("listing_id", state.id).order("sort_order", { ascending: false }).limit(1);
  let sort = (last?.[0]?.sort_order ?? -1) + 1;
  const { data: rows, error } = await supabase
    .from("listing_images")
    .insert(copied.map((c) => ({ listing_id: state.id, url: c.stored, sort_order: sort++, media_type: "image", source: "import", owner_id: userId, unit_id: unitId })))
    .select("id");
  if (error) throw new Error(`photos: ${error.message}`);
  if (unitId && rows?.length) {
    await supabase.from("listing_image_units").insert(rows.map((r) => ({ image_id: r.id, unit_id: unitId, created_by: userId })));
  }
  return rows?.length ?? 0;
}

/*
 * What the lease says about itself, apartments first so a student reading
 * two cards under one floor plan sees which is which: "Apts 10E, 12E.
 * Available now. 6 Weeks Free! Sign by 10/31...". The editor caps this at
 * 300 characters.
 */
/*
 * Two wordings of one special: the same opening, or the same numbers (months
 * free, dollar amounts) with most of the same words.
 */
const SPECIAL_STOP = new Set(["when", "with", "your", "this", "that", "from", "receive", "apply", "some", "please", "more", "information", "contact", "office", "leasing", "lease", "free", "month", "months"]);
export function sameSpecial(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na.slice(0, 40) === nb.slice(0, 40)) return true;
  const nums = (t) => new Set((t.match(/\d[\d,]*/g) ?? []).map((x) => x.replace(/,/g, "")));
  const words = (t) => new Set(t.split(/[^a-z]+/).filter((w) => w.length >= 4 && !SPECIAL_STOP.has(w)));
  const jac = (x, y) => { const u = new Set([...x, ...y]); if (!u.size) return 0; let i = 0; for (const v of x) if (y.has(v)) i++; return i / u.size; };
  const la = String(a).toLowerCase(), lb = String(b).toLowerCase();
  const xa = nums(la), xb = nums(lb);
  const sameNums = xa.size > 0 && xa.size === xb.size && [...xa].every((v) => xb.has(v));
  const overlap = jac(words(la), words(lb));
  if (xa.size || xb.size) return sameNums && (overlap >= 0.3 || (/free/.test(la) && /free/.test(lb)));
  return overlap >= 0.7;
}

/* A move-in date for comparing: null when it is today, past or unknown. */
export function moveInKey(date, today = new Date().toISOString().slice(0, 10)) {
  const d = date ? String(date).slice(0, 10) : null;
  return d && d > today ? d : null;
}

export function leaseBlurb(offer) {
  const parts = [apartmentsLabel(offer.apartments), offer.availableNow && !offer.availableFrom ? "Available now" : null, offer.special].filter(Boolean);
  if (!parts.length) return null;
  return parts.join(". ").replace(/\.\.(\s|$)/g, ".$1").slice(0, 300);
}

/**
 * The lead address a new apartment should take when the property itself has no
 * contact email: the one this owner already uses on the rest of the building.
 * Landlords can set the address per apartment rather than per property, and an
 * apartment added by a later sync would otherwise fall back to their account inbox.
 * Two or more different addresses is ambiguous, so it stays empty.
 */
export function buildingContactEmail(state, userId) {
  const emails = new Set();
  for (const unit of state.listing_units ?? []) {
    if (unit.deleted_at) continue;
    for (const lease of unit.unit_leases ?? []) {
      const email = lease.contact_email?.trim().toLowerCase();
      if (email && !lease.deleted_at && lease.owner_id === userId) emails.add(email);
    }
  }
  return emails.size === 1 ? [...emails][0] : null;
}

function leaseRow({ state, userId, unitId, offer, available, draft }) {
  return {
    unit_id: unitId,
    owner_id: userId,
    rent: offer.rent,
    rent_is_per_person: offer.rent == null ? null : !!offer.rentIsPerPerson,
    lease_term_months: offer.leaseTermMonths ?? [],
    available_from: offer.availableFrom ?? null,
    sublease: false,
    is_active: true,
    unavailable: !available,
    description: leaseBlurb(offer),
    furnished: state.furnished ?? null,
    contact_email: state.contact_email ?? buildingContactEmail(state, userId),
    contact_phone: state.contact_phone ?? null,
    contact_name: state.contact_name ?? null,
    ...(draft ? { published_at: null } : {}),
  };
}

/* Run one change record. Returns a short note of what was written. */
export async function executeChange(change, { state, userId }) {
  const d = change.detail;
  const slug = addressSlug(state.address);
  switch (d.op) {
    case "none":
      return "flagged";
    case "property_update": {
      const patch = { ...(d.patch ?? {}) };
      if (d.homeType) {
        const id = await homeTypeIdFor(d.homeType);
        if (id && !state.home_type_id) patch.home_type_id = id;
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("listings").update(patch).eq("id", state.id);
        if (error) throw new Error(`property: ${error.message}`);
      }
      if (d.amenities?.length) {
        const row = Object.fromEntries(AMENITY_COLS.map((c) => [c, d.amenities.includes(c)]));
        await supabase.from("listing_amenities").upsert({ listing_id: state.id, ...row }, { onConflict: "listing_id" });
      }
      if (d.utilities?.length) {
        const row = Object.fromEntries(UTILITY_COLS.map((c) => [c, d.utilities.includes(c)]));
        await supabase.from("listing_utilities").upsert({ listing_id: state.id, ...row }, { onConflict: "listing_id" });
      }
      if (d.customAmenities?.length) {
        await supabase.from("listing_custom_amenities").insert(d.customAmenities.map((label) => ({ listing_id: state.id, label })));
      }
      if (d.concessions?.length) {
        await supabase.from("listing_concessions").insert(
          d.concessions.map((description) => ({ listing_id: state.id, description, active: true, last_verified_at: new Date().toISOString(), last_verified_source: "source-sync" }))
        );
      }
      if (d.staleConcessions?.length) {
        await supabase.from("listing_concessions").update({ active: false }).in("id", d.staleConcessions);
      }
      return "property details";
    }
    case "photos_add": {
      const n = await insertImages({ state, userId, unitId: d.unitId, urls: d.urls, slug });
      // Real photos of the building retire the Street View stand-in that
      // was its cover (added when it was listed with nothing else).
      if (n > 0 && !d.unitId) {
        const removed = await dropStreetViewCover(state.id);
        if (removed) return `${n} photo${n === 1 ? "" : "s"}, Street View cover removed`;
      }
      return `${n} photo${n === 1 ? "" : "s"}`;
    }
    case "unit_insert": {
      const floorPlan = d.unit.floorPlanImageUrl ? await copyRemoteImage(d.unit.floorPlanImageUrl, { kind: "floor-plan", slug }) : null;
      const { data: unit, error } = await supabase
        .from("listing_units")
        .insert({
          listing_id: state.id,
          name: cleanUnitName(d.unit.name),
          bedrooms: d.unit.bedrooms ?? 0,
          bathrooms: d.unit.bathrooms ?? 1,
          area: d.unit.area,
          floor_plan_image_url: floorPlan,
          sort_order: await nextUnitSortOrder(state.id),
          ...(d.draft ? { published_at: null } : {}),
        })
        .select("id")
        .single();
      if (error) throw new Error(`unit: ${error.message}`);
      const offers = (d.offers ?? []).slice(0, MAX_LEASES_PER_UNIT);
      if (offers.length) {
        const { error: le } = await supabase.from("unit_leases").insert(offers.map((o) => leaseRow({ state, userId, unitId: unit.id, offer: o, available: d.available !== false, draft: d.draft })));
        if (le) throw new Error(`leases: ${le.message}`);
      }
      let photos = 0;
      if (d.photos?.length) photos = await insertImages({ state, userId, unitId: unit.id, urls: d.photos, slug });
      change.unitId = unit.id;
      return `${offers.length} lease${offers.length === 1 ? "" : "s"}${photos ? `, ${photos} photos` : ""}`;
    }
    case "unit_update": {
      const patch = {};
      for (const [k, v] of Object.entries(d.patch ?? {})) {
        if (k === "floorPlanImageUrl") {
          const stored = await copyRemoteImage(v, { kind: "floor-plan", slug });
          if (stored) patch.floor_plan_image_url = stored;
        } else patch[k] = v;
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("listing_units").update(patch).eq("id", d.unitId);
        if (error) throw new Error(`unit: ${error.message}`);
      }
      return Object.keys(patch).join(", ") || "nothing";
    }
    case "lease_insert": {
      const { error } = await supabase.from("unit_leases").insert(leaseRow({ state, userId, unitId: d.unitId, offer: d.offer, available: true, draft: !!d.draft }));
      if (error) throw new Error(`lease: ${error.message}`);
      return d.offer.rent != null ? `$${d.offer.rent}` : "unpriced";
    }
    case "lease_update": {
      const { error } = await supabase.from("unit_leases").update(d.patch).eq("id", d.leaseId);
      // The database keeps a lease withdrawn for an overdue invoice off the market
      // until an admin restores it (202611010002_billing_holds.sql).
      if (error && /lease_held_for_billing/.test(error.message ?? "")) throw new Error(HELD_FOR_BILLING_MESSAGE);
      if (error) throw new Error(`lease: ${error.message}`);
      return Object.keys(d.patch).join(", ");
    }
    case "lease_withdraw": {
      const { error } = await supabase.from("unit_leases").update({ unavailable: true }).eq("id", d.leaseId);
      if (error) throw new Error(`lease: ${error.message}`);
      return "withdrawn";
    }
    default:
      throw new Error(`unknown op ${d.op}`);
  }
}

// ---------------------------------------------------------------- events

async function recordEvents({ monitorId, listingId, changes, applied, status }) {
  if (!monitorId || !changes.length) return [];
  let fresh = changes;
  if (status === "open") {
    // The same held change, run after run, is one open event, not a pile.
    // A change a person rejected stays rejected while the website still says
    // the same thing (a month, then it is asked again); a new value on the
    // website is a new change. Rejections from a bulk clear-out do not count.
    const since = new Date(Date.now() - REJECTED_QUIET_DAYS * 86400000).toISOString();
    const [{ data: open }, { data: rejected }] = await Promise.all([
      supabase.from("listing_source_events").select("kind, unit_key, field, new_value, detail").eq("listing_id", listingId).eq("status", "open"),
      supabase.from("listing_source_events").select("kind, unit_key, field, new_value, detail").eq("listing_id", listingId).eq("status", "rejected").gte("verdict_at", since).limit(2000),
    ]);
    // The lease is part of the key: two leases of one floor plan given the
    // same update are two changes, not one (the second used to be dropped).
    const keyOf = (e) => `${e.kind}|${e.unit_key ?? ""}|${e.detail?.leaseId ?? ""}|${e.field ?? ""}|${JSON.stringify(e.new_value ?? null)}`;
    const seen = new Set([...(open ?? []), ...(rejected ?? []).filter((e) => !e.detail?.clearedBy)].map(keyOf));
    fresh = changes.filter((c) => {
      const key = `${c.kind}|${c.unitKey ?? ""}|${c.leaseId ?? c.detail?.leaseId ?? ""}|${c.field ?? ""}|${JSON.stringify(c.new ?? null)}`;
      if (seen.has(key)) return false;
      // ...and the same change twice in one read is one event too.
      seen.add(key);
      return true;
    });
    if (!fresh.length) return [];
  }
  const rows = fresh.map((c) => ({
    monitor_id: monitorId,
    listing_id: listingId,
    kind: c.kind,
    unit_key: c.unitKey ?? null,
    field: c.field ?? null,
    old_value: c.old ?? null,
    new_value: c.new ?? null,
    confidence: c.auto ? "high" : "low",
    status,
    applied,
    detail: { ...c.detail, note: c.note ?? null, judge: c.judgeResult ?? null, unitId: c.unitId ?? c.detail.unitId ?? null, leaseId: c.leaseId ?? c.detail.leaseId ?? null },
  }));
  const { data, error } = await supabase.from("listing_source_events").insert(rows).select("id");
  if (!error) return data ?? [];
  // One row the table refuses must not lose the rest: save them one by one.
  console.error(`[source-import] events: ${error.message}; saving ${rows.length} one at a time`);
  const saved = [];
  for (const row of rows) {
    const one = await supabase.from("listing_source_events").insert(row).select("id");
    if (one.error) console.error(`[source-import] event ${row.kind} ${row.unit_key ?? ""} not saved: ${one.error.message}`);
    else saved.push(...(one.data ?? []));
  }
  return saved;
}

/*
 * What a landlord has set by hand since launch: lease and unit ids, and
 * property fields as "property:<field>", from the knowledge store's core
 * provenance rows (lib/agents/store.js).
 */
async function landlordSetScopes(listingId) {
  const { data } = await supabase.from("listing_facts").select("field_key, scope_level, scope_id")
    .eq("listing_id", listingId).eq("section", "core").eq("landlord_set", true).eq("is_current", true).limit(2000);
  const out = new Set();
  for (const f of data ?? []) {
    if ((f.scope_level === "lease" || f.scope_level === "unit") && f.scope_id) out.add(f.scope_id);
    else if (f.scope_level === "property" && f.field_key.startsWith("core.property.")) out.add(`property:${f.field_key.slice("core.property.".length)}`);
  }
  return out;
}

/* Lease ids a previous sync withdrew, so a relist of one is routine. */
async function withdrawnBySyncFor(listingId) {
  const { data } = await supabase.from("listing_source_events").select("detail").eq("listing_id", listingId).eq("kind", "lease_withdrawn").eq("applied", true);
  return new Set((data ?? []).map((e) => e.detail?.leaseId).filter(Boolean));
}

// ---------------------------------------------------------------- entry

/*
 * A website can show more than one building (Wyatt, 2026-11-05): Mac
 * Properties' Coronado Place page also lists Lindell Tower East's floor plans,
 * which are their own listing on Proximity, and the 11/4 sync added all of
 * them to Coronado Place. And a sync used to put back any unit a person had
 * deleted, since it only compares the website with the units still there.
 *
 * So a new unit from the website is held for a person, never added, when
 *   - a unit with the same name is on another listing this landlord owns that
 *     is read from the same website (Wyatt, 2026-11-06: Coronado Place and
 *     Lindell Tower East are both on macapartments.com; buildings on their own
 *     websites often share names like "Studio" or "Apt 201" for real, and were
 *     held for nothing: 80 of 82 shared names in prod), or
 *   - a unit with the same name was removed from this listing.
 * Held, not dropped: it shows once in the review queue with the reason, and
 * applying it there still adds it on purpose.
 */
export async function holdUnitsBelongingElsewhere({ state, changes, ownerIds }) {
  const fresh = changes.filter((c) => c.kind === "unit_new" && c.auto !== false);
  if (!fresh.length) return;
  const removed = new Set((state.removedUnitNames ?? []).map(unitKeyOf));
  const elsewhere = new Map();
  if (ownerIds.length) {
    const { data: links } = await supabase.from("listing_landlords").select("listing_id").in("user_id", ownerIds).limit(2000);
    const others = [...new Set((links ?? []).map((l) => l.listing_id))].filter((id) => id !== state.id);
    for (let i = 0; i < others.length; i += 100) {
      const { data: units } = await supabase
        .from("listing_units")
        .select("name, listings!listing_id(title, address, deleted_at, source_url)")
        .in("listing_id", others.slice(i, i + 100))
        .is("deleted_at", null)
        .not("name", "is", null)
        .limit(5000);
      for (const u of units ?? []) {
        if (u.listings?.deleted_at) continue;
        // Another building on its own website: a shared name is just a shared name.
        if (!state.source_url || !u.listings?.source_url || !sameSite(state.source_url, u.listings.source_url)) continue;
        const key = unitKeyOf(u.name);
        if (key && !elsewhere.has(key)) elsewhere.set(key, u.listings?.title || u.listings?.address || "another listing");
      }
    }
  }
  for (const c of fresh) {
    const key = unitKeyOf(c.new?.name ?? c.detail?.unit?.name);
    if (!key) continue;
    const where = elsewhere.get(key);
    if (where || removed.has(key)) {
      c.auto = false;
      c.judge = false;
      c.note = where ? `already on ${where}; held instead of added` : "removed from this listing before; held instead of added back";
    }
  }
}

const unitKeyOf = (name) => norm(cleanUnitName(name ?? ""));

/*
 * Apply a snapshot. Returns { applied, held, holdReason, summary }.
 *
 *   mode       "import" onto a draft, "sync" onto a listing with data
 *   autoApply  false records every change as open and writes nothing: the
 *              "proposed changes" a landlord reviews on an existing listing
 */
export async function applySnapshot({ snapshot, listingId, userId = null, mode = "sync", monitorId = null, autoApply = true, teamReview = false, listingLabel = null, takeover = null }) {
  const state = await loadListingState(listingId);
  if (!state) throw new Error("listing not found");
  const ownerIds = ownerIdsOf(state);
  const actor = userId ?? primaryOwner(state);
  if (actor && !ownerIds.includes(actor)) ownerIds.push(actor);
  const withdrawnBySync = mode === "sync" ? await withdrawnBySyncFor(listingId) : new Set();

  const changes = planChanges({ state, snapshot, mode, ownerIds, withdrawnBySync, takeover });
  const label = listingLabel ?? state.title ?? state.address;
  if (mode === "sync") await holdUnitsBelongingElsewhere({ state, changes, ownerIds });

  // Holds: a snapshot the reader was unsure of, or too much churn at once.
  let holdReason = null;
  // A claim is the first real read of the building: its changes are already
  // checked one by one on the tab, so a cautious read does not hold them all.
  if (mode === "sync" && snapshot.confidence === "low" && !takeover) holdReason = "low_confidence";
  if (mode === "sync" && !holdReason) {
    const existing = state.listing_units.flatMap((u) => u.unit_leases.filter((l) => isMine(l, ownerIds))).length;
    // Churn is leases appearing, vanishing or repricing. A lease whose blurb
    // or lengths were reworded is the same lease; counting those once held
    // a building because every lease gained the words "Available now".
    const touched = changes.filter(
      (c) =>
        // A unit's own page speaks for that unit alone, so its changes are
        // not the building-wide churn this hold exists for.
        !c.detail?.fromUnitPage &&
        (["lease_new", "lease_withdrawn", "unit_relisted"].includes(c.kind) || (c.kind === "lease_updated" && /\b(rent|available_from|unavailable)\b/.test(c.field ?? "")))
    ).length;
    if (existing >= CHURN_MIN_LEASES && touched > Math.ceil(existing * CHURN_FRACTION)) holdReason = "churn_hold";
  }

  /*
   * Landlord-set values are never overwritten by a sync (PRD v3, "When
   * sources disagree"): a lease, unit or property field a landlord set after
   * launch has a core provenance row with landlord_set, and any change to it
   * is held for the landlord instead of applied.
   */
  if (mode === "sync") {
    const protectedIds = await landlordSetScopes(listingId);
    if (protectedIds.size) {
      for (const c of changes) {
        const leaseId = c.leaseId ?? c.detail?.leaseId ?? null;
        const unitId = c.unitId ?? c.detail?.unitId ?? null;
        const propertyHit = c.kind === "property_updated" && Object.keys(c.detail?.patch ?? {}).some((f) => protectedIds.has(`property:${f}`));
        if ((leaseId && protectedIds.has(leaseId)) || (unitId && protectedIds.has(unitId) && c.kind !== "lease_new") || propertyHit) {
          c.auto = false;
          c.judge = false;
          c.protected = true;
          c.note = "set by the landlord; held for their approval";
        }
      }
    }
  }

  // A lease going live passes the listing gate, as the landlord's own publish
  // would; the importer and sync used to skip it.
  // Under launch review it still runs, so the team sees why one would wait.
  if (mode === "sync" && changes.some((c) => (c.auto || teamReview) && putsLeaseLive(c))) {
    const gate = await gateFor(primaryOwner(state), listingId);
    if (!gate.allowed) {
      for (const c of changes.filter(putsLeaseLive)) {
        c.auto = false;
        c.judge = false;
        c.gated = true;
        c.note = `waiting for the landlord to publish: ${gate.message}`;
      }
    }
  }

  /*
   * Launch review (Wyatt, 2026-11-07, lib/agents/flags.js syncTeamReview):
   * nothing a sync finds changes what students see on its own. Every change,
   * a unit's own page included, waits for the Proximity team, and the
   * landlord does not see it.
   */
  if (mode === "sync" && teamReview) {
    for (const c of changes) {
      c.auto = false;
      c.judge = false;
      c.detail = { ...(c.detail ?? {}), teamReview: true };
    }
  }

  // The model's second opinion on the changes the rules would not apply.
  // Never on specs (beds, baths, size, name): those are the landlord's call,
  // then admin's (PRD v3).
  if (autoApply && !holdReason && mode === "sync") {
    for (const c of changes.filter((x) => !x.auto && x.judge && x.kind !== "spec_mismatch")) {
      const verdict = await judgeChange({ listingLabel: label, unitLabel: c.detail.label, field: c.field, oldValue: c.old, newValue: c.new, context: `kind ${c.kind}` });
      c.judgeResult = verdict;
      if (verdict.verdict === "apply") c.auto = true;
    }
  }

  const applied = [];
  const held = [];
  // On a building just claimed, the stub's prose, contact and photos are
  // replaced at once; what it says about units and leases is still offered
  // as changes to tick.
  const TAKEOVER_KINDS = new Set(["property_updated", "photos_added"]);
  if (takeover && (!autoApply || holdReason)) {
    for (const c of changes) {
      if (!TAKEOVER_KINDS.has(c.kind)) {
        held.push(c);
        continue;
      }
      try {
        c.note = await executeChange(c, { state, userId: actor });
        applied.push(c);
      } catch (err) {
        c.note = `failed: ${err.message}`;
        held.push(c);
      }
    }
  } else if (!autoApply) {
    held.push(...changes);
  } else {
    for (const c of changes) {
      // A held run still applies what a unit's own page said: the landlord
      // pointed at that page for that unit (Wyatt, 2026-11-06).
      if (!c.auto || (holdReason && !c.detail?.fromUnitPage)) {
        held.push(c);
        continue;
      }
      try {
        c.note = await executeChange(c, { state, userId: actor });
        applied.push(c);
      } catch (err) {
        c.note = `failed: ${err.message}`;
        c.auto = false;
        held.push(c);
      }
    }
  }

  await recordEvents({ monitorId, listingId, changes: applied, applied: true, status: "applied" });
  await recordEvents({ monitorId, listingId, changes: held, applied: false, status: "open" });
  if (holdReason && monitorId) {
    await recordEvents({ monitorId, listingId, changes: [{ kind: holdReason, field: "run", old: null, new: { changes: changes.length }, auto: false, detail: { op: "none", label, ...(teamReview ? { teamReview: true } : {}) } }], applied: false, status: "open" });
  }
  if (applied.length && mode === "sync") {
    await supabase.from("listings").update({ last_verified_at: new Date().toISOString(), last_verified_source: "source-sync" }).eq("id", listingId);
  }
  // A new import, or a building just claimed, gets its tabs in layout order.
  if ((mode === "import" || takeover) && applied.some((c) => c.kind === "unit_new")) await sortUnitsByLayout(listingId);
  return { applied, held, holdReason, summary: summarize(snapshot), takeover: !!takeover };
}

/*
 * Replay held changes a person accepted: the "apply these changes" button on
 * an existing listing's import tab, or a reviewed sync hold. Events already
 * applied are skipped; each success is marked applied with the verdict.
 */
export async function applyEvents({ listingId, eventIds, userId, verdictBy = null }) {
  const state = await loadListingState(listingId);
  if (!state) throw new Error("listing not found");
  const { data: events } = await supabase.from("listing_source_events").select("id, kind, unit_key, field, old_value, new_value, detail, applied, status").in("id", eventIds).eq("listing_id", listingId);
  // New floor plans join in layout order, unless the landlord arranged the
  // tabs by hand, in which case they go at the end as before.
  const addsUnits = (events ?? []).some((e) => e.kind === "unit_new" && !e.applied);
  const wasSorted = addsUnits ? await inLayoutOrder(listingId) : false;
  const results = [];
  // Accepting a change that puts a lease live is a publish: the same gate,
  // checked for the listing's landlord even when the team accepts it.
  const live = (events ?? []).filter((e) => !e.applied && putsLeaseLive(e));
  const gate = live.length ? await gateFor(primaryOwner(state) ?? userId, listingId) : { allowed: true };
  for (const e of events ?? []) {
    // A dismissed change stays dismissed (PR #365 review).
    if (e.applied || e.status === "rejected" || e.detail?.op === "none") continue;
    if (!gate.allowed && putsLeaseLive(e)) {
      results.push({ id: e.id, ok: false, error: gate.message });
      continue;
    }
    const change = { kind: e.kind, unitKey: e.unit_key, field: e.field, old: e.old_value, new: e.new_value, detail: e.detail };
    try {
      const note = await executeChange(change, { state, userId: userId ?? primaryOwner(state) });
      await supabase.from("listing_source_events").update({ applied: true, status: "applied", verdict: "accepted", verdict_by: verdictBy, verdict_at: new Date().toISOString(), detail: { ...e.detail, note } }).eq("id", e.id);
      results.push({ id: e.id, ok: true, note });
    } catch (err) {
      results.push({ id: e.id, ok: false, error: err.message });
    }
  }
  if (wasSorted && results.some((r) => r.ok)) await sortUnitsByLayout(listingId);
  return results;
}

export async function rejectEvents({ listingId, eventIds, verdictBy = null }) {
  await supabase.from("listing_source_events").update({ status: "rejected", verdict: "rejected", verdict_by: verdictBy, verdict_at: new Date().toISOString() }).in("id", eventIds).eq("listing_id", listingId).eq("applied", false);
}
