/*
 * DoorLoop connector (via Nango Proxy — custom API config, key "doorloop").
 *
 * DoorLoop's open REST API is self-serve on their Premium plan; auth is a
 * bearer API key (Settings → API Keys), stored in Nango. The Nango integration
 * is a custom API config with base URL https://app.doorloop.com/api.
 *
 * Data mapping:
 *   GET /properties -> properties ({ data: [{ id, name, address }] })
 *   GET /units      -> units ({ data: [{ id, name, property, beds, baths, size, marketRent, active }] })
 *   GET /leases     -> active leases ({ data: [{ id, units: [unitId], end, status }] })
 *
 * available = unit not covered by an active lease (and not inactive);
 * availableFrom = active lease end date when occupied.
 */
import { nangoProxyFetch } from "./nango.js";
import { toBedrooms, toBathrooms, toMoney, toIsoDate, toDescription, joinAddress } from "./types.js";

const PROVIDER_CONFIG_KEY = process.env.NANGO_DOORLOOP_KEY || "doorloop";
const PAGE_SIZE = 200;

async function pagedGet(connectionId, path, extraQuery = {}) {
  const rows = [];
  for (let page = 1; ; page++) {
    const res = await nangoProxyFetch({
      connectionId,
      providerConfigKey: PROVIDER_CONFIG_KEY,
      path,
      query: { ...extraQuery, page_size: String(PAGE_SIZE), page_number: String(page) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`DoorLoop ${path} failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : null;
    if (!data) throw new Error(`DoorLoop ${path}: unexpected response shape`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

export async function verifyConnection(connectionId) {
  try {
    const res = await nangoProxyFetch({
      connectionId,
      providerConfigKey: PROVIDER_CONFIG_KEY,
      path: "/properties",
      query: { page_size: "1", page_number: "1" },
    });
    if (!res.ok) return { ok: false, error: `DoorLoop returned ${res.status}` };
    const first = (await res.json())?.data?.[0];
    return { ok: true, accountLabel: first?.name || "DoorLoop account" };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not reach DoorLoop" };
  }
}

export async function fetchSnapshot(connectionId) {
  const errors = [];
  let properties = [];
  let units = [];
  let leases = [];

  try {
    properties = await pagedGet(connectionId, "/properties");
    units = await pagedGet(connectionId, "/units");
  } catch (err) {
    return { properties: [], errors: [err?.message || "DoorLoop fetch failed"] };
  }

  try {
    leases = await pagedGet(connectionId, "/leases");
  } catch (err) {
    errors.push(`leases fetch failed: ${err?.message || "unknown"}`);
    leases = null; // unknown occupancy -> available:null below
  }

  // Map active leases to the units they cover.
  const activeLeaseEndByUnit = new Map();
  if (leases) {
    for (const lease of leases) {
      const status = String(lease?.status || "").toUpperCase();
      if (status && status !== "ACTIVE") continue;
      const end = toIsoDate(lease?.end);
      for (const unitId of lease?.units || []) {
        const key = String(typeof unitId === "object" ? unitId?.id : unitId);
        const prev = activeLeaseEndByUnit.get(key);
        if (!prev || (end && end > prev)) activeLeaseEndByUnit.set(key, end);
      }
    }
  }

  const unitsByProperty = new Map();
  for (const u of units) {
    const propId = u?.property != null ? String(typeof u.property === "object" ? u.property?.id : u.property) : null;
    if (!propId) continue;
    const externalUnitId = String(u.id);
    const inactive = u?.active === false;
    const leased = leases ? activeLeaseEndByUnit.has(externalUnitId) : null;
    const available = inactive ? false : leased == null ? null : !leased;
    const normalized = {
      externalUnitId,
      label: u?.name || null,
      available,
      rent: toMoney(u?.marketRent ?? u?.rent),
      bedrooms: toBedrooms(u?.beds ?? u?.bedrooms),
      bathrooms: toBathrooms(u?.baths ?? u?.bathrooms),
      area: toMoney(u?.size ?? u?.sqft),
      availableFrom: leased ? activeLeaseEndByUnit.get(externalUnitId) || null : null,
      beds: null,
      rawStatus: inactive ? "inactive" : leased == null ? null : leased ? "leased" : "vacant",
    };
    if (!unitsByProperty.has(propId)) unitsByProperty.set(propId, []);
    unitsByProperty.get(propId).push(normalized);
  }

  const normalizedProperties = properties.map((p) => {
    const addr = p?.address || {};
    return {
      externalPropertyId: String(p.id),
      name: p?.name || null,
      address: joinAddress(addr?.street1, addr?.street2),
      city: addr?.city || null,
      state: addr?.state || null,
      zip: addr?.zip || null,
      description: toDescription(p?.description),
      units: unitsByProperty.get(String(p.id)) || [],
    };
  });

  return { properties: normalizedProperties, errors };
}

export const providerConfigKey = PROVIDER_CONFIG_KEY;
