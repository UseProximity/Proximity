/*
 * What the sync learns from the landlord's edits (Wyatt, 2026-11-11). Pure:
 * tested without a database (learnRules.test.js). lib/sourceImport/learn.js
 * loads and saves what these rules find (listing_sync_learnings).
 *
 * The landlord's own data always wins, and the sync cannot ask them what they
 * meant, so it compares what they did with what it read:
 *
 *   - It remembers the values it last wrote to each lease from the website.
 *     A lease that now says something else was changed by the landlord, and
 *     that field stays theirs until the website's own value moves again.
 *   - A unit the landlord renamed, or one the website calls by another name
 *     ("Candy" for their "2 Bedroom"), is the same unit from then on.
 *   - A landlord who turned the website's whole-apartment rent into a
 *     per-person rent states rents per person: the website's rents are
 *     divided by the bedrooms before they are compared with the leases.
 */

export const LEASE_FIELDS = ["rent", "rent_is_per_person", "lease_term_months", "available_from", "description"];

const norm = (v) => {
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v)) return [...v].map(Number).sort((a, b) => a - b);
  if (typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v))) return Number(v);
  return v;
};
export const sameValue = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/* The fields of a lease row the sync tracks. */
export function syncedLeaseValues(row) {
  const out = {};
  for (const f of LEASE_FIELDS) if (row && f in row) out[f] = row[f] ?? null;
  return out;
}

/* Fields the landlord changed since the sync last wrote them. */
export function editedFields(dbLease, synced) {
  if (!dbLease || !synced) return new Set();
  return new Set(LEASE_FIELDS.filter((f) => f in synced && !sameValue(dbLease[f], synced[f])));
}

/*
 * A lease change cut down to what the website actually changed. A field the
 * landlord edited stays theirs while the website still says what the sync
 * last wrote; when the website's value has moved, that is a real change and
 * it goes through. Returns { patch, dropped }.
 */
export function trimForLandlord(patch, dbLease, synced) {
  const edited = editedFields(dbLease, synced);
  const kept = {};
  const dropped = [];
  for (const [f, v] of Object.entries(patch ?? {})) {
    if (edited.has(f) && sameValue(v, synced[f])) dropped.push(f);
    else kept[f] = v;
  }
  // A rent and its basis travel together: dropping one drops both.
  if (dropped.includes("rent") && "rent_is_per_person" in kept) {
    delete kept.rent_is_per_person;
    dropped.push("rent_is_per_person");
  }
  if (dropped.includes("rent_is_per_person") && "rent" in kept) {
    delete kept.rent;
    dropped.push("rent");
  }
  return { patch: kept, dropped };
}

/*
 * The landlord turned a whole-apartment rent the sync wrote into a per-person
 * one: the same money split across the bedrooms (within 2%, or $5).
 */
export function rentBasisFrom(dbLease, synced, bedrooms) {
  const beds = Number(bedrooms);
  if (!dbLease || !synced || !(beds >= 2)) return null;
  if (synced.rent_is_per_person !== false || dbLease.rent_is_per_person !== true) return null;
  const whole = Number(synced.rent);
  const each = Number(dbLease.rent);
  if (!(whole > 0) || !(each > 0)) return null;
  return Math.abs(whole / beds - each) <= Math.max(5, each * 0.02) ? "per_person" : null;
}

/*
 * The website's rents as this landlord states them. With basis "per_person",
 * a whole-apartment rent on a unit of two or more bedrooms is divided by its
 * bedrooms. Mutates and returns the units.
 */
export function convertRentBasis(units, basis) {
  if (basis !== "per_person") return units;
  for (const u of units ?? []) {
    const beds = Number(u.bedrooms);
    if (!(beds >= 2)) continue;
    for (const o of u.offers ?? []) {
      if (o.rent == null || o.rentIsPerPerson) continue;
      o.rent = Math.round(o.rent / beds);
      o.rentIsPerPerson = true;
      o.rentBasisLearned = true;
    }
  }
  return units;
}

/*
 * Units the website names differently from the landlord, pinned to the
 * landlord's unit. Only units still on the listing, and never two website
 * units onto one. Mutates and returns the units.
 */
export function applyAliases(units, aliases, liveUnitIds) {
  const taken = new Set((units ?? []).map((u) => u.pinnedUnitId).filter(Boolean));
  for (const u of units ?? []) {
    if (u.pinnedUnitId) continue;
    const id = aliases.get(u.key);
    if (!id || !liveUnitIds.has(id) || taken.has(id)) continue;
    u.pinnedUnitId = id;
    u.aliasOf = id;
    taken.add(id);
  }
  return units;
}

/*
 * A unit the sync created (or last saw) under the website's name that the
 * landlord has since renamed: the website's key for it, or null.
 */
export function renamedUnitKey(dbUnit, syncedUnit) {
  if (!dbUnit || !syncedUnit?.siteKey || !syncedUnit.name) return null;
  return String(dbUnit.name ?? "").trim() !== String(syncedUnit.name).trim() ? syncedUnit.siteKey : null;
}
