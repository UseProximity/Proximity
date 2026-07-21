/*
 * AppFolio connector (via Nango Proxy — custom API config, key "appfolio").
 *
 * AppFolio's customer-credentialed Reporting API v2: the landlord generates a
 * Client ID/Secret in-product (General Settings → Manage API Settings) — no
 * Stack partnership needed. Plus tier (read-only Reporting API) is sufficient.
 * Auth is HTTP Basic against https://{subdomain}.appfolio.com; the Nango
 * integration's base URL uses a "subdomain" connection-config field collected
 * by the Connect UI. Rate limit ~7 req/15s; large reports page via
 * next_page_url (absolute URL, exempt from rate limits).
 *
 * Data mapping (report endpoints, POST/GET /api/v2/reports/{name}.json):
 *   unit_directory -> one row per unit: property/unit identity, beds/baths,
 *                     sqft, market rent, unit_status ("Occupied", "Vacant-…")
 *   rent_roll      -> lease end dates for occupied units
 */
import { nangoProxyFetch } from "./nango.js";
import { toBedrooms, toBathrooms, toMoney, toIsoDate } from "./types.js";

const PROVIDER_CONFIG_KEY = process.env.NANGO_APPFOLIO_KEY || "appfolio";

// Fetch every row of one report, following next_page_url. The first request
// goes through the Nango proxy (which injects Basic auth + subdomain);
// next_page_url is absolute, so follow-ups override the proxy base URL.
async function fetchReport(connectionId, report) {
  const rows = [];
  let res = await nangoProxyFetch({
    connectionId,
    providerConfigKey: PROVIDER_CONFIG_KEY,
    path: `/api/v2/reports/${report}.json`,
    method: "POST",
    query: { paginate_results: "true" },
    body: {},
  });

  for (;;) {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AppFolio ${report} failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const results = Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : null;
    if (!results) throw new Error(`AppFolio ${report}: unexpected response shape`);
    rows.push(...results);

    const next = json?.next_page_url;
    if (!next) return rows;
    res = await nangoProxyFetch({
      connectionId,
      providerConfigKey: PROVIDER_CONFIG_KEY,
      path: next.replace(/^https?:\/\/[^/]+/, ""),
      method: "GET",
    });
  }
}

const pick = (row, ...keys) => {
  for (const k of keys) {
    if (row?.[k] != null && row[k] !== "") return row[k];
  }
  return null;
};

export async function verifyConnection(connectionId) {
  try {
    const res = await nangoProxyFetch({
      connectionId,
      providerConfigKey: PROVIDER_CONFIG_KEY,
      path: "/api/v2/reports/unit_directory.json",
      method: "POST",
      query: { paginate_results: "true" },
      body: {},
    });
    if (!res.ok) return { ok: false, error: `AppFolio returned ${res.status}` };
    return { ok: true, accountLabel: "AppFolio account" };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not reach AppFolio" };
  }
}

export async function fetchSnapshot(connectionId) {
  const errors = [];
  let unitRows = [];
  let rentRoll = [];

  try {
    unitRows = await fetchReport(connectionId, "unit_directory");
  } catch (err) {
    return { properties: [], errors: [err?.message || "unit_directory fetch failed"] };
  }

  try {
    rentRoll = await fetchReport(connectionId, "rent_roll");
  } catch (err) {
    errors.push(`rent_roll fetch failed: ${err?.message || "unknown"}`);
    rentRoll = [];
  }

  // Lease end date per unit from the rent roll.
  const leaseEndByUnit = new Map();
  for (const row of rentRoll) {
    const unitKey = pick(row, "unit_id", "unit", "unit_name");
    const end = toIsoDate(pick(row, "lease_to", "lease_end", "move_out"));
    if (unitKey == null || !end) continue;
    const key = String(unitKey);
    const prev = leaseEndByUnit.get(key);
    if (!prev || end > prev) leaseEndByUnit.set(key, end);
  }

  // unit_directory is flat — group rows into properties by property identity.
  const propMap = new Map();
  for (const row of unitRows) {
    const propKey = String(pick(row, "property_id", "property", "property_name") ?? "unknown");
    const unitKey = pick(row, "unit_id", "unit", "unit_name");
    if (unitKey == null) continue;

    const status = pick(row, "unit_status", "status");
    const statusText = status == null ? null : String(status).toLowerCase();
    // "Vacant-Unrented" / "Vacant-Rented" / "Occupied" / "Notice-…"
    const available = statusText == null ? null : statusText.startsWith("vacant");

    if (!propMap.has(propKey)) {
      propMap.set(propKey, {
        externalPropertyId: propKey,
        name: pick(row, "property_name", "property"),
        address: pick(row, "property_address", "address"),
        city: pick(row, "property_city", "city"),
        state: pick(row, "property_state", "state"),
        zip: pick(row, "property_zip", "zip", "postal_code"),
        units: [],
      });
    }
    propMap.get(propKey).units.push({
      externalUnitId: String(unitKey),
      label: pick(row, "unit_name", "unit"),
      available,
      rent: toMoney(pick(row, "market_rent", "rent", "advertised_rent")),
      bedrooms: toBedrooms(pick(row, "bedrooms", "beds", "br")),
      bathrooms: toBathrooms(pick(row, "bathrooms", "baths", "ba")),
      area: toMoney(pick(row, "sqft", "square_feet", "unit_size")),
      availableFrom: available === false ? leaseEndByUnit.get(String(unitKey)) || null : null,
      beds: null,
      rawStatus: status == null ? null : String(status),
    });
  }

  return { properties: [...propMap.values()], errors };
}

export const providerConfigKey = PROVIDER_CONFIG_KEY;
