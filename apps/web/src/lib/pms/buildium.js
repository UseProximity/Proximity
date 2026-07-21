/*
 * Buildium connector (via Nango Proxy — provider config key "buildium").
 *
 * Buildium auth is API-key headers (x-buildium-client-id / x-buildium-client-secret),
 * injected by Nango; we never see the keys. Requires the landlord's Buildium
 * plan to include Open API access (Premium — includes one free sandbox).
 *
 * Data mapping:
 *   GET /v1/rentals                    -> properties (Id, Name, Address)
 *   GET /v1/rentals/units              -> units (Id, PropertyId, UnitNumber,
 *                                         UnitBedrooms, UnitBathrooms, UnitSize,
 *                                         MarketRent, IsUnitOccupied)
 *   GET /v1/leases?leasestatuses=Active-> active leases (UnitId, LeaseToDate)
 *
 * available = !IsUnitOccupied; availableFrom = active lease end date when
 * occupied (pre-leased-for-next-term is NOT stale). Unknown -> null (no action).
 */
import { nangoProxyFetch } from "./nango.js";
import { isMockConnection, mockVerify, mockSnapshot } from "./mock.js";
import { toBedrooms, toBathrooms, toMoney, toIsoDate, joinAddress } from "./types.js";

const PROVIDER_CONFIG_KEY = process.env.NANGO_BUILDIUM_KEY || "buildium";
const PAGE_LIMIT = 500;

async function pagedGet(connectionId, path, extraQuery = {}) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const res = await nangoProxyFetch({
      connectionId,
      providerConfigKey: PROVIDER_CONFIG_KEY,
      path,
      query: { ...extraQuery, limit: String(PAGE_LIMIT), offset: String(offset) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Buildium ${path} failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error(`Buildium ${path}: unexpected response shape`);
    rows.push(...page);
    if (page.length < PAGE_LIMIT) return rows;
  }
}

export async function verifyConnection(connectionId) {
  if (isMockConnection(connectionId)) return mockVerify();
  try {
    const res = await nangoProxyFetch({
      connectionId,
      providerConfigKey: PROVIDER_CONFIG_KEY,
      path: "/v1/rentals",
      query: { limit: "1", offset: "0" },
    });
    if (!res.ok) return { ok: false, error: `Buildium returned ${res.status}` };
    const first = (await res.json())?.[0];
    return { ok: true, accountLabel: first?.Name || "Buildium account" };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not reach Buildium" };
  }
}

export async function fetchSnapshot(connectionId) {
  if (isMockConnection(connectionId)) return mockSnapshot();
  const errors = [];
  let properties = [];
  let units = [];
  let leases = [];

  try {
    properties = await pagedGet(connectionId, "/v1/rentals");
  } catch (err) {
    // Without the property list nothing can be trusted — return an empty,
    // errored snapshot; the sync refuses to reconcile it.
    return { properties: [], errors: [err?.message || "properties fetch failed"] };
  }

  try {
    units = await pagedGet(connectionId, "/v1/rentals/units");
  } catch (err) {
    return { properties: [], errors: [err?.message || "units fetch failed"] };
  }

  try {
    leases = await pagedGet(connectionId, "/v1/leases", { leasestatuses: "Active" });
  } catch (err) {
    // Leases only enrich availableFrom — degrade gracefully.
    errors.push(`leases fetch failed: ${err?.message || "unknown"}`);
    leases = [];
  }

  // Latest active-lease end date per unit -> availableFrom for occupied units.
  const leaseEndByUnit = new Map();
  for (const lease of leases) {
    const unitId = lease?.UnitId ?? lease?.Unit?.Id;
    const end = toIsoDate(lease?.LeaseToDate);
    if (unitId == null || !end) continue;
    const prev = leaseEndByUnit.get(String(unitId));
    if (!prev || end > prev) leaseEndByUnit.set(String(unitId), end);
  }

  const unitsByProperty = new Map();
  for (const u of units) {
    const propId = u?.PropertyId != null ? String(u.PropertyId) : null;
    if (!propId) continue;
    const externalUnitId = String(u.Id);
    const occupied = typeof u?.IsUnitOccupied === "boolean" ? u.IsUnitOccupied : null;
    const normalized = {
      externalUnitId,
      label: u?.UnitNumber || u?.Description || null,
      available: occupied == null ? null : !occupied,
      rent: toMoney(u?.MarketRent),
      bedrooms: toBedrooms(u?.UnitBedrooms),
      bathrooms: toBathrooms(u?.UnitBathrooms),
      area: toMoney(u?.UnitSize),
      availableFrom: occupied ? leaseEndByUnit.get(externalUnitId) || null : null,
      beds: null,
      rawStatus: occupied == null ? null : occupied ? "occupied" : "vacant",
    };
    if (!unitsByProperty.has(propId)) unitsByProperty.set(propId, []);
    unitsByProperty.get(propId).push(normalized);
  }

  const normalizedProperties = properties.map((p) => {
    const addr = p?.Address || {};
    return {
      externalPropertyId: String(p.Id),
      name: p?.Name || null,
      address: joinAddress(addr?.AddressLine1, addr?.AddressLine2),
      city: addr?.City || null,
      state: addr?.State || null,
      zip: addr?.PostalCode || null,
      units: unitsByProperty.get(String(p.Id)) || [],
    };
  });

  return { properties: normalizedProperties, errors };
}

export const providerConfigKey = PROVIDER_CONFIG_KEY;
