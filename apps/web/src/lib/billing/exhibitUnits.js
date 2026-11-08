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
 *   A live property the landlord leaves off Exhibit A comes off the site once the
 *       document is signed (planCoverage's `withdraw`, applied in applyEnvelope),
 *       never on Continue, so an abandoned popup changes nothing.
 *
 * `db` is a service-role Supabase client.
 */
import { BillingError } from "./errors.js";
import { coverageFor } from "./agreements.js";
import { exhibitChoice, planCoverage, resolvePublishedIds, unitLabel, withRequiredUnits } from "./coverage.js";

const NAME_MAX = 60;

export async function exhibitPreview(db, userId, { listingIds = [], requiredUnits = null, now = new Date() } = {}) {
  const requested = await resolvePublishedIds(db, listingIds);
  const loaded = await coverageFor(db, userId, now);
  const { state, rows, covered } = loaded;
  const properties = withRequiredUnits(loaded.properties, requiredUnits);
  // A document already in progress (an addendum started from a publish, then closed)
  // is planned with, as startSigning does, so "Continue signing" picks it up again.
  const inProgress = state.valid && state.pendingAmendment ? state.pendingAmendment.proposed_exhibit ?? [] : state.pending?.exhibit ?? [];
  const carryFromAmendment = !state.valid && state.pendingAmendment ? state.pendingAmendment.proposed_exhibit ?? [] : [];
  const carry = [...inProgress, ...carryFromAmendment];
  const plan = planCoverage({ properties, rows, master: state.signed, masterValid: state.valid, requestedIds: requested, carry });
  if (plan.kind === "none") return { kind: "none", properties: [] };
  const locked = new Set([...requested, ...properties.filter((p) => p.live).map((p) => p.listingId), ...carry.map((e) => e.listingId)]);
  // Every property, on an amendment too, so nothing goes on (or changes) unseen:
  // what is covered already shows as covered and stays as it is (Wyatt, 2026-11-07).
  const shown = properties;
  // An addendum is signed with the agreement's saved details: who that is, for the popup.
  const saved = plan.kind === "amendment" && state.signed?.signer_details && state.signed?.signer_name ? state.signed : null;
  return {
    kind: plan.kind,
    signingAs: saved
      ? { name: saved.signer_name, title: saved.signer_title ?? "", company: saved.signer_details.company ?? "" }
      : null,
    properties: shown.map((p) => {
      const cov = plan.kind === "amendment" ? covered.get(p.listingId) : null;
      return {
        listingId: p.listingId,
        address: p.address,
        live: p.live,
        draft: p.draft,
        canWholeBuilding: !!p.owner,
        locked: locked.has(p.listingId),
        // Anything but a property being published, or one on the agreement already,
        // can be left off; one with the landlord's leases then comes off the site.
        canExclude: !requested.includes(p.listingId) && !cov,
        units: p.unitList,
        leaseUnits: p.leaseUnits,
        requiredUnits: p.requiredUnits ?? [],
        covered: cov ? { wholeBuilding: cov.whole_building !== false, units: cov.units ?? [] } : null,
        choice: exhibitChoice(p, null, { locked: locked.has(p.listingId), covered: cov ?? null }),
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

// The landlord's leases on these properties' units: [{ id, unit_id, is_active }].
// Asked per property (a query returns at most 1,000 rows, and a big landlord has
// more leases than that across all their properties; 2026-11-07).
async function leasesOn(db, userId, listingIds) {
  const out = [];
  for (const listingId of listingIds) {
    const units = await unitsOf(db, listingId);
    for (let i = 0; i < units.length; i += 200) {
      const { data, error } = await db
        .from("unit_leases")
        .select("id, unit_id, is_active")
        .eq("owner_id", userId)
        .is("deleted_at", null)
        .in("unit_id", units.slice(i, i + 200).map((u) => u.id));
      if (error) throw error;
      out.push(...(data ?? []));
    }
  }
  return out;
}

async function leaseUnitIds(db, userId, listingId) {
  return new Set((await leasesOn(db, userId, [listingId])).map((l) => l.unit_id));
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
