/*
 * Rentec Direct connector (via Nango Proxy — provider config key "rentec").
 *
 * Rentec's v3 API is key-in-header (X-API-Key), self-serve and free on every
 * Pro/PM account: the landlord generates a READ-scoped key at
 * Settings → Tools → Utilities → API Keys and pastes it into Nango's window.
 * Base URL: https://secure.rentecdirect.com/api/v3 (set in the Nango config).
 *
 * Data mapping (spec: secure.rentecdirect.com/api/v3/docs/openapi.yaml):
 *   GET /ping                                     -> connection check + company label
 *   GET /properties?include_subunits=true
 *                  &marketing=true                -> everything in ONE call:
 *     units are "subunits" (child Property rows, sub_of = parent id);
 *     a standalone property is its own single unit. monthly_rent = market
 *     rent; marketing{bedrooms,bathrooms,sqft} when the landlord filled it in;
 *     renters[] (move_in/move_out) drives occupancy.
 *   GET /leases                                   -> current + future leases
 *     (the API's default window) -> lease_end/move_out per property_id feeds
 *     availableFrom for occupied units (pre-leased ≠ stale).
 *
 * available: no current or future renter -> true; renter present -> false with
 * availableFrom = latest lease end; renters[] absent -> null (no action).
 * Responses use a {summary, data} envelope; /properties and /leases are NOT
 * paginated (full set in one response). Rate limit 60 req/min — we make 2.
 */
import { nangoProxyFetch } from "./nango.js";
import { isMockConnection, mockVerify, mockSnapshot } from "./mock.js";
import { toBedrooms, toBathrooms, toMoney, toIsoDate, toDescription, joinAddress } from "./types.js";

const PROVIDER_CONFIG_KEY = process.env.NANGO_RENTEC_KEY || "rentec";

async function getData(connectionId, path, query = {}) {
  const res = await nangoProxyFetch({
    connectionId,
    providerConfigKey: PROVIDER_CONFIG_KEY,
    path,
    query,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Rentec ${path} failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const data = json?.data ?? json;
  if (!Array.isArray(data) && typeof data !== "object") {
    throw new Error(`Rentec ${path}: unexpected response shape`);
  }
  return data;
}

export async function verifyConnection(connectionId) {
  if (isMockConnection(connectionId)) return mockVerify();
  try {
    const data = await getData(connectionId, "/ping");
    return { ok: true, accountLabel: data?.user?.company || "Rentec Direct account" };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not reach Rentec Direct" };
  }
}

// Occupancy from renters[]: a current renter (moved in, not moved out) OR a
// future renter (signed, moving in later) both make the unit not-available.
// renters missing entirely -> unknown -> null (the sync takes no action).
function renterState(renters, today) {
  if (!Array.isArray(renters)) return { available: null, moveOuts: [] };
  const active = renters.filter((r) => {
    const moveOut = toIsoDate(r?.move_out);
    return !moveOut || moveOut >= today;
  });
  return {
    available: active.length === 0,
    moveOuts: active.map((r) => toIsoDate(r?.move_out)).filter(Boolean),
  };
}

function normalizeUnit(row, leaseEndByProperty, today) {
  const marketing = row?.marketing || null;
  const { available, moveOuts } = renterState(row?.renters, today);
  const propertyId = String(row.property_id ?? row.id);
  let availableFrom = null;
  if (available === false) {
    const ends = [leaseEndByProperty.get(propertyId), ...moveOuts].filter(Boolean).sort();
    availableFrom = ends[ends.length - 1] || null; // latest commitment end
  }
  return {
    externalUnitId: propertyId,
    label: row?.nickname || row?.address || null,
    available,
    rent: toMoney(row?.monthly_rent),
    bedrooms: toBedrooms(marketing?.bedrooms),
    bathrooms: toBathrooms(marketing?.bathrooms),
    area: toMoney(marketing?.sqft),
    availableFrom,
    beds: null,
    rawStatus: available == null ? null : available ? "vacant" : "occupied",
  };
}

export async function fetchSnapshot(connectionId) {
  if (isMockConnection(connectionId)) return mockSnapshot();
  const errors = [];
  const today = new Date().toISOString().slice(0, 10);

  let properties = [];
  try {
    properties = await getData(connectionId, "/properties", {
      include_subunits: "true",
      marketing: "true",
    });
  } catch (err) {
    // Without the property list nothing can be trusted — the sync refuses
    // to reconcile an empty, errored snapshot.
    return { properties: [], errors: [err?.message || "properties fetch failed"] };
  }

  let leases = [];
  try {
    leases = await getData(connectionId, "/leases");
  } catch (err) {
    // Leases only enrich availableFrom — degrade gracefully.
    errors.push(`leases fetch failed: ${err?.message || "unknown"}`);
    leases = [];
  }

  // Latest lease commitment end per property (units are properties in Rentec).
  const leaseEndByProperty = new Map();
  for (const lease of leases) {
    const propertyId = lease?.property_id != null ? String(lease.property_id) : null;
    const end = toIsoDate(lease?.move_out) || toIsoDate(lease?.lease_end);
    if (!propertyId || !end) continue;
    const prev = leaseEndByProperty.get(propertyId);
    if (!prev || end > prev) leaseEndByProperty.set(propertyId, end);
  }

  // Normalization must not throw — the contract says fetchSnapshot returns
  // {properties, errors}, never raises. A malformed shape becomes an errored,
  // empty snapshot so the cron refuses to reconcile it.
  if (!Array.isArray(properties)) {
    return { properties: [], errors: [...errors, "properties response was not an array"] };
  }
  const normalizedProperties = [];
  for (const p of properties) {
    // Children appear nested under their parent's subunits[] — skip any that
    // also surface as top-level rows so no unit is counted twice.
    if (p?.sub_of != null) continue;
    if (p?.archived) continue;
    const subunits = Array.isArray(p?.subunits) ? p.subunits.filter((u) => !u?.archived) : [];
    const units = (subunits.length ? subunits : [p]).map((row) =>
      normalizeUnit(row, leaseEndByProperty, today)
    );
    // Marketing copy lives on the rows that carry marketing objects (the
    // standalone row itself, or a subunit); keep the longest one.
    const marketingRows = subunits.length ? subunits : [p];
    let description = null;
    for (const row of marketingRows) {
      const d = toDescription(row?.marketing?.description ?? row?.comments);
      if (d && (!description || d.length > description.length)) description = d;
    }
    normalizedProperties.push({
      externalPropertyId: String(p.property_id ?? p.id),
      name: p?.nickname || null,
      address: p?.address || null,
      city: p?.city || null,
      state: p?.state || null,
      zip: p?.zip != null ? String(p.zip) : null,
      description,
      units,
    });
  }

  return { properties: normalizedProperties, errors };
}

export const providerConfigKey = PROVIDER_CONFIG_KEY;
