/*
 * Schema alignment — does what the PMS gave us actually fit our tables?
 *
 * The normalization layer in types.js is deliberately forgiving: a rent it
 * can't parse becomes null, a bedroom count it doesn't recognize becomes null.
 * That is the right behaviour for a nightly sync (never write a guess), but it
 * means a provider whose columns are named differently than we expect degrades
 * silently — the listing just quietly has no price, and nobody finds out.
 *
 * This module makes that visible BEFORE anything is written. It walks a
 * normalized snapshot and reports every place the data would not survive a
 * trip into `listings` / `listing_units`, split into three severities:
 *
 *   blocker  — ingest would fail or write something false. A NOT NULL column
 *              with nothing to put in it, or no address to geocode.
 *   gap      — ingest succeeds but the listing is missing something students
 *              search on (rent, availability).
 *   note     — worth knowing, not worth acting on (no area, no marketing copy).
 *
 * The severities are the contract: `blocker` is what "this doesn't match our
 * schema" means in the alert email, and it is the only tier that should ever
 * stop a property from being offered for ingest.
 *
 * Ground truth for these rules (verified against the live dev DB):
 *   listing_units.bedrooms   integer NOT NULL
 *   listing_units.bathrooms  numeric NOT NULL   <- ingest.js defaults null to 1
 *   listing_units.available  boolean NOT NULL default true
 *   listing_units.area       numeric NULL
 *   listings.latitude/longitude are required by rpc_pms_ingest_listing, and
 *   come from geocoding the joined address — so a missing address is a blocker
 *   two steps before the insert.
 */
import { joinAddress } from "./types.js";
import { applyLeasingHorizon, groupUnitsToTypes, leasingHorizonEnd } from "./mapping.js";

const BLOCKER = "blocker";
const GAP = "gap";
const NOTE = "note";

// One finding. `expected` and `received` are what make the alert email
// actionable — "bedrooms: expected integer, received "Loft"" tells whoever
// reads it exactly which mapping to add.
function finding({ severity, code, message, field = null, expected = null, received = null, property = null, unit = null }) {
  return { severity, code, message, field, expected, received, property, unit };
}

// A property with no address can't be geocoded, and rpc_pms_ingest_listing
// requires coordinates. Everything else about the property is recoverable.
function checkProperty(prop) {
  const out = [];
  const address = joinAddress(prop.address, prop.city, prop.state, prop.zip);
  const label = prop.name || prop.externalPropertyId;

  if (!address) {
    out.push(
      finding({
        severity: BLOCKER,
        code: "property_no_address",
        field: "listings.address",
        message: "No address on the property, so it cannot be placed on the map.",
        expected: "street, city, state, zip",
        received: JSON.stringify({ address: prop.address ?? null, city: prop.city ?? null, state: prop.state ?? null, zip: prop.zip ?? null }),
        property: label,
      })
    );
  } else if (!prop.zip || !prop.city) {
    // Geocoding usually still succeeds, but accuracy drops and the campus
    // radius filter is only as good as the coordinates.
    out.push(
      finding({
        severity: NOTE,
        code: "property_partial_address",
        field: "listings.address",
        message: "Address is missing its city or ZIP, so the map pin may be approximate.",
        expected: "street, city, state, zip",
        received: address,
        property: label,
      })
    );
  }

  if (!prop.name) {
    out.push(
      finding({
        severity: NOTE,
        code: "property_no_name",
        field: "listings.title",
        message: "No property name, so the listing title falls back to the address.",
        property: label,
      })
    );
  }

  if (!prop.units?.length) {
    out.push(
      finding({
        severity: BLOCKER,
        code: "property_no_units",
        field: "listing_units",
        message: "No units on the property, so there is nothing to list.",
        property: label,
      })
    );
  }

  return out;
}

// Unit-level checks run against the RAW unit (pre-horizon), because that is
// where a coercion failure is still visible: rawStatus carries what the PMS
// actually said before availability was resolved.
function checkUnit(prop, unit) {
  const out = [];
  const label = prop.name || prop.externalPropertyId;
  const unitLabel = unit.label || unit.externalUnitId;

  if (unit.bedrooms == null) {
    out.push(
      finding({
        severity: BLOCKER,
        code: "unit_no_bedrooms",
        field: "listing_units.bedrooms",
        message: "Bedroom count could not be read, and the column cannot be empty.",
        expected: "integer (or a recognized word form such as TwoBed)",
        received: unit.rawBedrooms ?? null,
        property: label,
        unit: unitLabel,
      })
    );
  }

  // ingest.js writes `type.bathrooms ?? 1`. That keeps the insert legal but
  // invents a fact, so it is reported rather than left to be discovered by a
  // student filtering on bathrooms.
  if (unit.bathrooms == null) {
    out.push(
      finding({
        severity: GAP,
        code: "unit_no_bathrooms",
        field: "listing_units.bathrooms",
        message: "Bathroom count could not be read. The column cannot be empty, so it would be written as 1.",
        expected: "number (or a recognized word form such as OnePointFiveBath)",
        received: unit.rawBathrooms ?? null,
        property: label,
        unit: unitLabel,
      })
    );
  }

  if (unit.rent == null) {
    out.push(
      finding({
        severity: GAP,
        code: "unit_no_rent",
        field: "listing_units.rent",
        message: "No rent could be read for this unit, so it would show without a price.",
        expected: "positive number",
        received: unit.rawRent ?? null,
        property: label,
        unit: unitLabel,
      })
    );
  }

  if (unit.available == null) {
    out.push(
      finding({
        severity: GAP,
        code: "unit_unknown_availability",
        field: "listing_units.available",
        message: "Occupancy is unknown, so the sync will take no action on this unit.",
        expected: "a recognized status",
        received: unit.rawStatus ?? null,
        property: label,
        unit: unitLabel,
      })
    );
  }

  if (unit.area == null) {
    out.push(
      finding({
        severity: NOTE,
        code: "unit_no_area",
        field: "listing_units.area",
        message: "No square footage. The column allows it; the listing just won't show a size.",
        property: label,
        unit: unitLabel,
      })
    );
  }

  return out;
}

/*
 * Validate a whole normalized snapshot.
 *
 * Returns { ok, counts, findings, properties } where `properties` carries a
 * per-property verdict the preview UI can use to mark a card unusable, and
 * `ok` is true only when nothing is a blocker.
 */
export function validateSnapshot(snapshot) {
  const findings = [];
  const properties = [];
  const horizonEnd = leasingHorizonEnd();

  for (const prop of snapshot.properties ?? []) {
    const propFindings = checkProperty(prop);
    for (const unit of prop.units ?? []) propFindings.push(...checkUnit(prop, unit));

    // Grouping is where physical units become the floor-plan types we store.
    // A group keyed on a null bedroom count is the same blocker as above, but
    // reported once per property instead of once per unit.
    if (prop.units?.length) {
      const groups = groupUnitsToTypes(applyLeasingHorizon(prop.units, horizonEnd));
      const unusable = groups.filter((g) => g.type.bedrooms == null).length;
      if (unusable) {
        propFindings.push(
          finding({
            severity: BLOCKER,
            code: "type_not_groupable",
            field: "listing_units",
            message: `${unusable} floor-plan type${unusable === 1 ? "" : "s"} could not be formed because bedroom counts were unreadable.`,
            property: prop.name || prop.externalPropertyId,
          })
        );
      }
    }

    const blockers = propFindings.filter((f) => f.severity === BLOCKER);
    properties.push({
      externalPropertyId: prop.externalPropertyId,
      name: prop.name || null,
      ingestable: blockers.length === 0,
      blockers: blockers.length,
      gaps: propFindings.filter((f) => f.severity === GAP).length,
    });
    findings.push(...propFindings);
  }

  const counts = {
    properties: (snapshot.properties ?? []).length,
    units: (snapshot.properties ?? []).reduce((n, p) => n + (p.units?.length ?? 0), 0),
    blockers: findings.filter((f) => f.severity === BLOCKER).length,
    gaps: findings.filter((f) => f.severity === GAP).length,
    notes: findings.filter((f) => f.severity === NOTE).length,
    ingestable: properties.filter((p) => p.ingestable).length,
  };

  return { ok: counts.blockers === 0, counts, findings, properties };
}

/*
 * Collapse findings into one line per distinct problem, with a count and one
 * example. A 200-unit portfolio missing rent everywhere is ONE mapping bug,
 * and an email that lists it 200 times is an email nobody reads twice.
 */
export function summarizeFindings(findings) {
  const byCode = new Map();
  for (const f of findings) {
    if (!byCode.has(f.code)) byCode.set(f.code, { ...f, count: 0, examples: [] });
    const row = byCode.get(f.code);
    row.count += 1;
    if (row.examples.length < 3) {
      row.examples.push([f.property, f.unit].filter(Boolean).join(" / ") || "—");
    }
  }
  const order = { [BLOCKER]: 0, [GAP]: 1, [NOTE]: 2 };
  return [...byCode.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
}

/*
 * The landlord-facing version: plain language, no field names, no counts of
 * our own mapping failures. They chose not to see the internals, and a
 * property manager reading "listing_units.bathrooms is NOT NULL" learns
 * nothing except that we might not know what we're doing.
 */
export function landlordNotes(findings) {
  const notes = [];
  const n = (code) => findings.filter((f) => f.code === code).length;

  const noAddress = n("property_no_address");
  if (noAddress) notes.push(`${noAddress} propert${noAddress === 1 ? "y has" : "ies have"} no address we could place on the map.`);

  const noRent = n("unit_no_rent");
  if (noRent) notes.push(`${noRent} unit${noRent === 1 ? "" : "s"} came through without a price.`);

  const noBeds = n("unit_no_bedrooms");
  if (noBeds) notes.push(`${noBeds} unit${noBeds === 1 ? "" : "s"} came through without a bedroom count.`);

  const unknown = n("unit_unknown_availability");
  if (unknown) notes.push(`${unknown} unit${unknown === 1 ? "'s" : "s'"} availability wasn't clear from the data.`);

  return notes;
}

export const SEVERITY = { BLOCKER, GAP, NOTE };
