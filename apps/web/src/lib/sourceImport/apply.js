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

const CHURN_FRACTION = 0.2;
const CHURN_MIN_LEASES = 5;
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
         unit_leases(id, rent, rent_is_per_person, lease_term_months, available_from, unavailable, is_active, owner_id, description, deleted_at, published_at)),
       listing_images(id, url, unit_id, sort_order, source),
       listing_amenities(*), listing_utilities(*),
       listing_custom_amenities(id, label),
       listing_concessions(id, description, active, last_verified_source)`
    )
    .eq("id", listingId)
    .maybeSingle();
  if (error) throw new Error(`load listing: ${error.message}`);
  if (!row || row.deleted_at) return null;
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
  const pairs = [];
  for (const s of snapUnits) {
    const sName = norm(s.name);
    let hit = sName ? pool.find((p) => !p.used && norm(p.u.name) === sName) : null;
    if (!hit && s.bedrooms != null && s.bathrooms != null) {
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

// ---------------------------------------------------------------- planning

/*
 * Everything the snapshot would change, as replayable change records. Pure:
 * reads the loaded state, writes nothing.
 *
 * mode "import" fills a fresh draft; mode "sync" reconciles a listing that
 * already has data. The difference shows up in a few places: a sync adds new
 * units as drafts and leaves prose alone, an import writes everything.
 */
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
  const haveConcessions = new Set((state.listing_concessions ?? []).filter((c) => c.active).map((c) => norm(c.description).slice(0, 40)));
  const concessions = p.concessions.filter((c) => !haveConcessions.has(norm(c).slice(0, 40)));
  const staleConcessions =
    mode === "sync"
      ? (state.listing_concessions ?? [])
          .filter((c) => c.active && c.last_verified_source === "source-sync" && !p.concessions.some((n) => norm(n).slice(0, 40) === norm(c.description).slice(0, 40)))
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
    for (const o of offers) {
      const k = leaseKey(o.rent, o.rentIsPerPerson);
      seen.add(k);
      const l = byKey.get(k);
      const apartments = leaseBlurb(o);
      if (!l) {
        if (o.rent == null && mine.some((x) => x.rent == null)) continue;
        push({
          kind: "lease_new",
          unitKey: snap.key,
          unitId: db.id,
          field: "rent",
          old: null,
          new: { rent: o.rent, rentIsPerPerson: o.rentIsPerPerson, leaseTermMonths: o.leaseTermMonths, availableFrom: o.availableFrom, apartments: o.apartments },
          detail: { op: "lease_insert", unitId: db.id, label, offer: o, draft: false },
        });
        continue;
      }
      const lp = {};
      const diff = {};
      if (o.leaseTermMonths.length && !sameTerms(o.leaseTermMonths, l.lease_term_months)) {
        lp.lease_term_months = o.leaseTermMonths;
        diff.leaseTermMonths = { old: l.lease_term_months ?? [], new: o.leaseTermMonths };
      }
      if ((o.availableFrom ?? null) !== (l.available_from ?? null)) {
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
        push({ kind: "lease_updated", unitKey: snap.key, unitId: db.id, leaseId: l.id, field: Object.keys(diff).join(","), old: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.old])), new: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.new])), detail: { op: "lease_update", leaseId: l.id, label, patch: lp } });
      }
    }
    // A price the site no longer offers (or a unit it stopped offering).
    for (const l of mine) {
      if (l.unavailable || seen.has(leaseKey(l.rent, l.rent_is_per_person))) continue;
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
export function leaseBlurb(offer) {
  const parts = [apartmentsLabel(offer.apartments), offer.availableNow && !offer.availableFrom ? "Available now" : null, offer.special].filter(Boolean);
  if (!parts.length) return null;
  return parts.join(". ").replace(/\.\.(\s|$)/g, ".$1").slice(0, 300);
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
    contact_email: state.contact_email ?? null,
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
    const { data: open } = await supabase.from("listing_source_events").select("kind, unit_key, field, new_value").eq("listing_id", listingId).eq("status", "open");
    const seen = new Set((open ?? []).map((e) => `${e.kind}|${e.unit_key ?? ""}|${e.field ?? ""}|${JSON.stringify(e.new_value ?? null)}`));
    fresh = changes.filter((c) => !seen.has(`${c.kind}|${c.unitKey ?? ""}|${c.field ?? ""}|${JSON.stringify(c.new ?? null)}`));
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
  if (error) console.error("[source-import] events:", error.message);
  return data ?? [];
}

/* Lease ids a previous sync withdrew, so a relist of one is routine. */
async function withdrawnBySyncFor(listingId) {
  const { data } = await supabase.from("listing_source_events").select("detail").eq("listing_id", listingId).eq("kind", "lease_withdrawn").eq("applied", true);
  return new Set((data ?? []).map((e) => e.detail?.leaseId).filter(Boolean));
}

// ---------------------------------------------------------------- entry

/*
 * Apply a snapshot. Returns { applied, held, holdReason, summary }.
 *
 *   mode       "import" onto a draft, "sync" onto a listing with data
 *   autoApply  false records every change as open and writes nothing: the
 *              "proposed changes" a landlord reviews on an existing listing
 */
export async function applySnapshot({ snapshot, listingId, userId = null, mode = "sync", monitorId = null, autoApply = true, listingLabel = null, takeover = null }) {
  const state = await loadListingState(listingId);
  if (!state) throw new Error("listing not found");
  const ownerIds = ownerIdsOf(state);
  const actor = userId ?? primaryOwner(state);
  if (actor && !ownerIds.includes(actor)) ownerIds.push(actor);
  const withdrawnBySync = mode === "sync" ? await withdrawnBySyncFor(listingId) : new Set();

  const changes = planChanges({ state, snapshot, mode, ownerIds, withdrawnBySync, takeover });
  const label = listingLabel ?? state.title ?? state.address;

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
      (c) => ["lease_new", "lease_withdrawn", "unit_relisted"].includes(c.kind) || (c.kind === "lease_updated" && /\b(rent|available_from|unavailable)\b/.test(c.field ?? ""))
    ).length;
    if (existing >= CHURN_MIN_LEASES && touched > Math.ceil(existing * CHURN_FRACTION)) holdReason = "churn_hold";
  }

  // The model's second opinion on the changes the rules would not apply.
  if (autoApply && !holdReason && mode === "sync") {
    for (const c of changes.filter((x) => !x.auto && x.judge)) {
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
  } else if (!autoApply || holdReason) {
    held.push(...changes);
  } else {
    for (const c of changes) {
      if (!c.auto) {
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
    await recordEvents({ monitorId, listingId, changes: [{ kind: holdReason, field: "run", old: null, new: { changes: changes.length }, auto: false, detail: { op: "none", label } }], applied: false, status: "open" });
  }
  if (applied.length && mode === "sync") {
    await supabase.from("listings").update({ last_verified_at: new Date().toISOString(), last_verified_source: "source-sync" }).eq("id", listingId);
  }
  return { applied, held, holdReason, summary: summarize(snapshot) };
}

/*
 * Replay held changes a person accepted: the "apply these changes" button on
 * an existing listing's import tab, or a reviewed sync hold. Events already
 * applied are skipped; each success is marked applied with the verdict.
 */
export async function applyEvents({ listingId, eventIds, userId, verdictBy = null }) {
  const state = await loadListingState(listingId);
  if (!state) throw new Error("listing not found");
  const { data: events } = await supabase.from("listing_source_events").select("id, kind, unit_key, field, old_value, new_value, detail, applied").in("id", eventIds).eq("listing_id", listingId);
  const results = [];
  for (const e of events ?? []) {
    if (e.applied || e.detail?.op === "none") continue;
    const change = { kind: e.kind, unitKey: e.unit_key, field: e.field, old: e.old_value, new: e.new_value, detail: e.detail };
    try {
      const note = await executeChange(change, { state, userId: userId ?? primaryOwner(state) });
      await supabase.from("listing_source_events").update({ applied: true, status: "applied", verdict: "accepted", verdict_by: verdictBy, verdict_at: new Date().toISOString(), detail: { ...e.detail, note } }).eq("id", e.id);
      results.push({ id: e.id, ok: true, note });
    } catch (err) {
      results.push({ id: e.id, ok: false, error: err.message });
    }
  }
  return results;
}

export async function rejectEvents({ listingId, eventIds, verdictBy = null }) {
  await supabase.from("listing_source_events").update({ status: "rejected", verdict: "rejected", verdict_by: verdictBy, verdict_at: new Date().toISOString() }).in("id", eventIds).eq("listing_id", listingId);
}
