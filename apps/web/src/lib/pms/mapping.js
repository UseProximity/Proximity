/*
 * Mapping between PMS physical units and Proximity's listing model.
 *
 * Proximity listing_units are floor-plan TYPES (bedrooms/bathrooms/area), not
 * physical units — a 12-unit building is typically 2–3 types. PMS units are
 * physical. So:
 *   - ingest: group PMS units into types; a type is available when ANY of its
 *     physical units is available; rent = cheapest available (else cheapest).
 *   - sync: each pms_link carries listing_unit_id (its type); the cron rolls
 *     physical availability up to the type the same way.
 */

const typeKey = (bedrooms, bathrooms) => `${bedrooms ?? "?"}|${bathrooms ?? "?"}`;

// ---------------------------------------------------------------------------
// Pre-leasing horizon
//
// Students shop months ahead: a unit leased through July is exactly what a
// January shopper wants for August. `available = !occupied` alone would sink
// every fully pre-leased building, so availability is evaluated against a
// leasing horizon: a unit counts as available when it's vacant NOW or its
// current lease ends within the horizon (surfaced as "Available Aug 1").
// ---------------------------------------------------------------------------

export const DEFAULT_LEASING_HORIZON_MONTHS = 12;

// "YYYY-MM-DD" horizon cutoff, PMS_LEASING_HORIZON_MONTHS months from `now`.
export function leasingHorizonEnd(now = new Date()) {
  const months =
    Number(process.env.PMS_LEASING_HORIZON_MONTHS) || DEFAULT_LEASING_HORIZON_MONTHS;
  const d = new Date(now);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Horizon-aware availability for one unit. Unknown occupancy stays unknown.
export function unitAvailableWithinHorizon(unit, horizonEnd) {
  if (unit.available === true) return true;
  if (unit.available === false) {
    return Boolean(unit.availableFrom && horizonEnd && unit.availableFrom <= horizonEnd);
  }
  return null;
}

// Re-express units through the horizon so the existing roll-ups apply
// unchanged: available becomes horizon-aware, and a vacant-now unit reports
// availableFrom = today (so "earliest availableFrom" resolves to "now").
export function applyLeasingHorizon(units, horizonEnd, today = new Date().toISOString().slice(0, 10)) {
  return units.map((u) => ({
    ...u,
    available: unitAvailableWithinHorizon(u, horizonEnd),
    availableFrom: u.available === true ? today : u.availableFrom,
  }));
}

// Roll a set of physical PMS units up to one type-level summary.
// available: true if any unit is available, false if all known-false,
// null if occupancy is unknown across the board (sync takes no action).
export function rollUpAvailability(units) {
  let sawKnown = false;
  for (const u of units) {
    if (u.available === true) return true;
    if (u.available === false) sawKnown = true;
  }
  return sawKnown ? false : null;
}

// Cheapest rent among available units, else cheapest overall. Null-safe.
export function rollUpRent(units) {
  const rents = (pool) => pool.map((u) => u.rent).filter((r) => r != null);
  const available = rents(units.filter((u) => u.available === true));
  const pool = available.length ? available : rents(units);
  return pool.length ? Math.min(...pool) : null;
}

// Earliest availableFrom among the units that report one.
export function rollUpAvailableFrom(units) {
  const dates = units.map((u) => u.availableFrom).filter(Boolean).sort();
  return dates[0] || null;
}

// Group physical PMS units into Proximity unit types for rpc_create_listing.
// Returns [{ type: {bedrooms, bathrooms, area, rent, available, leaseAvailability},
//            unitIds: [externalUnitId, ...] }]
export function groupUnitsToTypes(pmsUnits) {
  const groups = new Map();
  for (const u of pmsUnits) {
    const key = typeKey(u.bedrooms, u.bathrooms);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }
  return [...groups.values()].map((units) => {
    const areas = units.map((u) => u.area).filter((a) => a != null);
    const available = rollUpAvailability(units);
    return {
      type: {
        bedrooms: units[0].bedrooms,
        bathrooms: units[0].bathrooms,
        area: areas.length ? Math.min(...areas) : null,
        rent: rollUpRent(units),
        // Occupancy unknown must not hide a brand-new listing — default available.
        available: available !== false,
        leaseAvailability: rollUpAvailableFrom(units),
      },
      unitIds: units.map((u) => u.externalUnitId),
    };
  });
}

// Match each physical PMS unit to an existing listing_units type row (by
// bedrooms, then bedrooms+bathrooms when both known). Unmatched -> null
// (the sync then only drives listing-level availability for that unit).
export function matchUnitsToListingUnits(pmsUnits, listingUnits) {
  const byUnit = new Map();
  for (const u of pmsUnits) {
    const exact = listingUnits.find(
      (t) =>
        t.bedrooms === u.bedrooms &&
        (u.bathrooms == null || t.bathrooms == null || Number(t.bathrooms) === u.bathrooms)
    );
    const bedsOnly = exact || listingUnits.find((t) => t.bedrooms === u.bedrooms);
    byUnit.set(u.externalUnitId, bedsOnly?.id ?? null);
  }
  return byUnit;
}
