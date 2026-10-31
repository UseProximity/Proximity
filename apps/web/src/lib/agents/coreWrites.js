/*
 * Displayed fields, written by the agent (PRD v3, "Edit by conversation").
 *
 * Core values (rent, availability, lease length, furnished, withdrawn; a
 * unit's beds, baths, size and name; the property's description) live in
 * the listing, unit and lease tables. The agent changes them through the
 * same checks the dashboard editor uses (canManageLease, isPropertyOwner,
 * the description content rules) and the same columns, then records a core
 * provenance row marked landlord_set so a sync never overwrites them.
 *
 * markLandlordSet is also called by the dashboard's own routes after a
 * successful edit: a dashboard edit after launch counts as landlord-set
 * (Wyatt, 2026-10-26).
 *
 * No scheduled changes: a value changes now or not at all.
 */
import supabase from "@/lib/supabase";
import { canManageLease, isPropertyOwner } from "@/lib/listings/ownership";
import { checkListingDescription } from "@/lib/contentRules";
import { cleanUnitName } from "@/utils/unitName";
import { findUnitNamed } from "@/lib/listings/unitNames";
import { setFact } from "./store";
import { money, shortDate } from "./sections";

export const LEASE_FIELDS = {
  rent: { col: "rent", parse: (v) => (v === null || v === "" ? null : Number(String(v).replace(/[$,\s]/g, ""))), check: (n) => n == null || (Number.isFinite(n) && n >= 0 && n <= 100000), label: "rent" },
  available_from: { col: "available_from", parse: (v) => (v ? String(v).slice(0, 10) : null), check: (d) => d == null || /^\d{4}-\d{2}-\d{2}$/.test(d), label: "available from" },
  lease_term_months: { col: "lease_term_months", parse: (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/)).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 36), check: (a) => Array.isArray(a), label: "lease length (months)" },
  furnished: { col: "furnished", parse: (v) => (v == null ? null : /^(true|yes|furnished|1)$/i.test(String(v)) || v === true), check: () => true, label: "furnished" },
  unavailable: { col: "unavailable", parse: (v) => /^(true|yes|1)$/i.test(String(v)) || v === true, check: () => true, label: "taken off the market" },
  rent_is_per_person: { col: "rent_is_per_person", parse: (v) => (v == null ? null : /^(true|yes|1|per person)$/i.test(String(v)) || v === true), check: () => true, label: "rent is per person" },
};
export const UNIT_FIELDS = {
  bedrooms: { col: "bedrooms", parse: (v) => (v === "" || v == null ? null : Number(v)), check: (n) => n == null || (Number.isFinite(n) && n >= 0 && n <= 20), label: "bedrooms" },
  bathrooms: { col: "bathrooms", parse: (v) => (v === "" || v == null ? null : Number(v)), check: (n) => n == null || (Number.isFinite(n) && n >= 0 && n <= 20), label: "bathrooms" },
  area: { col: "area", parse: (v) => (v === "" || v == null ? null : Number(String(v).replace(/[,\s]/g, ""))), check: (n) => n == null || (Number.isFinite(n) && n >= 0 && n <= 100000), label: "square feet" },
  name: { col: "name", parse: cleanUnitName, check: () => true, label: "unit name" },
};
export const PROPERTY_FIELDS = {
  description: { col: "description", parse: (v) => (typeof v === "string" ? v.trim() || null : null), check: () => true, label: "description" },
  furnished: { col: "furnished", parse: (v) => !!v && !/^(false|no|0)$/i.test(String(v)), check: () => true, label: "furnished" },
  sublease_friendly: { col: "sublease_friendly", parse: (v) => !!v && !/^(false|no|0)$/i.test(String(v)), check: () => true, label: "subletting allowed" },
};

const fmt = (field, v) => {
  if (v == null) return "not set";
  if (field === "rent") return money(v);
  if (field === "available_from") return shortDate(v);
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
};

/*
 * Record that a landlord set these core values, so the sync holds changes
 * to them instead of applying them. One row per field, scoped to the lease,
 * unit or property.
 */
export async function markLandlordSet({ listingId, target, id = null, fields, userId, cause = "dashboard", detail = {} }) {
  const scopeLevel = target === "property" ? "property" : target;
  for (const [field, value] of Object.entries(fields ?? {})) {
    try {
      await setFact({
        listingId, section: "core", fieldKey: `core.${target}.${field}`, scopeLevel, scopeId: target === "property" ? null : id,
        value: { value, set_at: new Date().toISOString() }, summary: `${field.replace(/_/g, " ")} set by the landlord: ${fmt(field, value)}`,
        landlordSet: true, setBy: userId, actorId: userId, cause, detail: { core: true, target, id, field, ...detail },
      });
    } catch (err) {
      console.error("[agents] markLandlordSet failed:", err?.message ?? err);
    }
  }
}

/* The 14-day hold: an owner who claimed the listing recently (PRD v3). */
export async function recentlyClaimed(userId, listingId) {
  const { data } = await supabase.from("listing_landlords").select("claimed_at").eq("listing_id", listingId).eq("user_id", userId).maybeSingle();
  if (!data?.claimed_at) return false;
  return Date.now() - new Date(data.claimed_at).getTime() < 14 * 86400000;
}

/*
 * Apply one change to a displayed field. change = { target: "lease" |
 * "unit" | "property", id, field, value }. Returns { ok, old, new, label }
 * or { error }.
 */
export async function applyCoreChange({ listingId, userId, isAdmin = false, change, cause = "landlord_chat" }) {
  const { target, id, field } = change ?? {};
  const spec = (target === "lease" ? LEASE_FIELDS : target === "unit" ? UNIT_FIELDS : target === "property" ? PROPERTY_FIELDS : {})[field];
  if (!spec) return { error: `Cannot change ${field ?? "that"} on a ${target ?? "thing"}.` };
  let value;
  try { value = spec.parse(change.value); } catch { return { error: `Bad value for ${spec.label}.` }; }
  if (!spec.check(value)) return { error: `That is not a valid ${spec.label}.` };

  if (target === "lease") {
    if (!isAdmin) {
      const check = await canManageLease(userId, id);
      if (!check?.ok) return { error: "You can only change your own leases." };
    }
    const { data: lease } = await supabase.from("unit_leases").select(`id, ${spec.col}, listing_units!unit_id(listing_id, name)`).eq("id", id).is("deleted_at", null).maybeSingle();
    if (!lease || lease.listing_units?.listing_id !== listingId) return { error: "That lease is not on this listing." };
    const old = lease[spec.col];
    const patch = { [spec.col]: value };
    if (field === "unavailable") patch.is_active = !value;
    const { error } = await supabase.from("unit_leases").update(patch).eq("id", id);
    if (error) return { error: `Could not save: ${error.message}` };
    await markLandlordSet({ listingId, target: "lease", id, fields: { [field]: value }, userId, cause, detail: { old } });
    return { ok: true, old, new: value, label: `${spec.label} on ${lease.listing_units?.name || "the lease"}: ${fmt(field, old)} to ${fmt(field, value)}` };
  }
  if (target === "unit") {
    if (!isAdmin && !(await isPropertyOwner(userId, listingId))) return { error: "Only the property owner can change a unit's details." };
    const { data: unit } = await supabase.from("listing_units").select(`id, listing_id, name, ${spec.col}`).eq("id", id).is("deleted_at", null).maybeSingle();
    if (!unit || unit.listing_id !== listingId) return { error: "That unit is not on this listing." };
    if (field === "name" && value && (await findUnitNamed(listingId, value, { excludeId: id }))) return { error: "Another unit here already has that name." };
    const old = unit[spec.col];
    const { error } = await supabase.from("listing_units").update({ [spec.col]: value }).eq("id", id);
    if (error) return { error: `Could not save: ${error.message}` };
    await markLandlordSet({ listingId, target: "unit", id, fields: { [field]: value }, userId, cause, detail: { old } });
    return { ok: true, old, new: value, label: `${spec.label} on ${unit.name || "the unit"}: ${fmt(field, old)} to ${fmt(field, value)}` };
  }
  if (target === "property") {
    if (!isAdmin && !(await isPropertyOwner(userId, listingId))) return { error: "Only the property owner can change the property's details." };
    const { data: listing } = await supabase.from("listings").select(`id, ${spec.col}`).eq("id", listingId).maybeSingle();
    if (!listing) return { error: "Listing not found." };
    if (field === "description" && value) {
      const problem = checkListingDescription(value, { previous: listing.description ?? null });
      if (problem) return { error: typeof problem === "string" ? problem : problem.message ?? "That description breaks the listing rules." };
    }
    const old = listing[spec.col];
    const { error } = await supabase.from("listings").update({ [spec.col]: value }).eq("id", listingId);
    if (error) return { error: `Could not save: ${error.message}` };
    await markLandlordSet({ listingId, target: "property", fields: { [field]: value }, userId, cause, detail: { old } });
    return { ok: true, old, new: value, label: `${spec.label}: ${fmt(field, old)} to ${fmt(field, value)}` };
  }
  return { error: "Unknown target." };
}
