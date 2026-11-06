/*
 * The Exhibit A step of the signing popup (Wyatt, 2026-11-07): what a landlord
 * sees and can change before the document is built.
 *
 *   exhibitPreview(db, userId, { listingIds })  each property that can go on this
 *       document, with its units, what is covered already, and the default choice
 *   addUnit / renameUnit   a unit the landlord names here: a real unit on the
 *       property (unpublished, no leases) or a new name for one (a floor plan or
 *       unit). Only on a property they own, or, for a renter, one where they have
 *       leases (renaming: a unit holding their leases).
 *
 * `db` is a service-role Supabase client.
 */
import { BillingError } from "./errors.js";
import { coverageFor } from "./agreements.js";
import { coversProperty, exhibitChoice, planCoverage, resolvePublishedIds, unitLabel } from "./coverage.js";

const NAME_MAX = 60;

export async function exhibitPreview(db, userId, { listingIds = [], now = new Date() } = {}) {
  const requested = await resolvePublishedIds(db, listingIds);
  const { state, properties, rows, covered } = await coverageFor(db, userId, now);
  const plan = planCoverage({ properties, rows, master: state.signed, masterValid: state.valid, requestedIds: requested });
  if (plan.kind === "none") return { kind: "none", properties: [] };
  const locked = new Set([...requested, ...properties.filter((p) => p.live).map((p) => p.listingId)]);
  // An agreement lists everything; an amendment, what is not fully covered yet.
  const shown = plan.kind === "master" ? properties : properties.filter((p) => !coversProperty(p, covered.get(p.listingId)));
  return {
    kind: plan.kind,
    properties: shown.map((p) => {
      const cov = plan.kind === "amendment" ? covered.get(p.listingId) : null;
      return {
        listingId: p.listingId,
        address: p.address,
        live: p.live,
        draft: p.draft,
        canWholeBuilding: !!p.owner,
        locked: locked.has(p.listingId),
        units: p.unitList,
        leaseUnits: p.leaseUnits,
        covered: cov ? { wholeBuilding: cov.whole_building !== false, units: cov.units ?? [] } : null,
        choice: exhibitChoice(p, null, { locked: locked.has(p.listingId) }),
      };
    }),
  };
}

function cleanName(name) {
  const n = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!n) throw new BillingError("name_required", "Give the unit a name, like 1A or 2 Bed.");
  if (n.length > NAME_MAX) throw new BillingError("name_too_long", `Keep the unit name under ${NAME_MAX} characters.`);
  return n;
}

async function ownsListing(db, userId, listingId) {
  const { data, error } = await db.from("listing_landlords").select("listing_id").eq("user_id", userId).eq("listing_id", listingId).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function leaseUnitIds(db, userId, listingId) {
  const { data, error } = await db
    .from("unit_leases")
    .select("unit_id, listing_units!unit_id(listing_id)")
    .eq("owner_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
  return new Set((data ?? []).filter((l) => l.listing_units?.listing_id === listingId).map((l) => l.unit_id));
}

async function unitsOf(db, listingId) {
  const { data, error } = await db
    .from("listing_units")
    .select("id, listing_id, name, unit_number, unit_designator, title, deleted_at")
    .eq("listing_id", listingId)
    .is("deleted_at", null);
  if (error) throw error;
  return data ?? [];
}

const taken = (units, name, exceptId = null) =>
  units.some((u) => u.id !== exceptId && String(unitLabel(u) ?? "").toLowerCase() === name.toLowerCase());

export async function addUnit(db, userId, { listingId, name, bedrooms, bathrooms }) {
  const label = cleanName(name);
  const beds = Number(bedrooms);
  const baths = Number(bathrooms);
  if (!Number.isInteger(beds) || beds < 0 || beds > 20) throw new BillingError("bad_bedrooms", "Bedrooms is a whole number (0 for a studio).");
  if (!Number.isFinite(baths) || baths < 0 || baths > 20 || Math.round(baths * 2) !== baths * 2) {
    throw new BillingError("bad_bathrooms", "Bathrooms is a number like 1 or 1.5.");
  }
  const owner = await ownsListing(db, userId, listingId);
  if (!owner && !(await leaseUnitIds(db, userId, listingId)).size) throw new BillingError("not_found", "That property was not found.", 404);
  const units = await unitsOf(db, listingId);
  if (taken(units, label)) throw new BillingError("unit_exists", `This property already has a unit called ${label}.`, 409);
  // Unpublished and with no leases: students see nothing until a lease is added in the editor.
  const { data, error } = await db
    .from("listing_units")
    .insert({ listing_id: listingId, name: label, bedrooms: beds, bathrooms: baths, published_at: null })
    .select("id, name")
    .single();
  if (error) throw error;
  return { id: data.id, label: data.name };
}

export async function renameUnit(db, userId, { unitId, name }) {
  const label = cleanName(name);
  const { data: unit, error } = await db
    .from("listing_units")
    .select("id, listing_id, name, unit_number, unit_designator, title, deleted_at")
    .eq("id", unitId)
    .maybeSingle();
  if (error) throw error;
  if (!unit || unit.deleted_at) throw new BillingError("not_found", "That unit was not found.", 404);
  const owner = await ownsListing(db, userId, unit.listing_id);
  if (!owner && !(await leaseUnitIds(db, userId, unit.listing_id)).has(unit.id)) throw new BillingError("not_found", "That unit was not found.", 404);
  if (taken(await unitsOf(db, unit.listing_id), label, unit.id)) throw new BillingError("unit_exists", `This property already has a unit called ${label}.`, 409);
  // The name is what the site and Exhibit A show (unitLabel reads it first).
  const { error: saveError } = await db.from("listing_units").update({ name: label }).eq("id", unit.id);
  if (saveError) throw saveError;
  return { id: unit.id, label };
}
