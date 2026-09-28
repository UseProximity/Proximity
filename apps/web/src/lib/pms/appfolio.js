/*
 * AppFolio connector (via Nango Proxy — "private-api-basic" template, key
 * "appfolio", with a per-request Base-Url-Override to {subdomain}.appfolio.com).
 *
 * AppFolio's customer-credentialed Reports API v2: the landlord generates a
 * Client ID/Secret in-product (General Settings → Manage API Settings →
 * Reports API Credentials) — no Stack partnership needed. Plus tier (read-only
 * reporting) is sufficient. Nango vaults the pair as Basic auth
 * (Client ID = username, Client Secret = password) and injects it on every
 * proxy call; the subdomain is NOT a secret and lives in
 * pms_connections.credential_meta as {"subdomain": "..."} — connectors receive
 * it via the `meta` argument.
 *
 * Reports used (POST /api/v2/reports/{name}.json, Content-Type mandatory):
 *   unit_directory -> identity + numeric beds/baths/sqft/rents per unit
 *   unit_vacancy   -> availability (unit_status, available_on) per unit
 *   rent_roll      -> lease end dates (REQUIRES as_of_to filter)
 * unit_directory and unit_vacancy are joined on unit_id. unit_vacancy's
 * bed_and_bath is a combined display string ("2 bd / 1 ba") and is never
 * parsed — numeric columns come from unit_directory only.
 *
 * Conservative default: only units the landlord advertises
 * (posted_to_internet / visibility) or that are actually available are
 * surfaced — a landlord's fully occupied, unadvertised portfolio is not
 * ingested. Set credential_meta.includeAllUnits = true on a connection to
 * lift this (occupied units then still surface only via the pre-leasing
 * horizon when a lease end date is known).
 *
 * Rate limit 7 req/15s (429 retried by httpRetry); next_page_url requests are
 * exempt and must carry NO filters. Pages cache for 30 minutes upstream.
 */
import { nangoProxyFetch } from "./nango.js";
import { toBedrooms, toBathrooms, toMoney, toIsoDate, toDescription } from "./types.js";

const PROVIDER_CONFIG_KEY = process.env.NANGO_APPFOLIO_KEY || "appfolio";
const MAX_PAGES = 60; // 5k rows/page; backstop against a misbehaving paginator

// SSRF guard: the subdomain is landlord-supplied text interpolated into a URL.
// Anything that isn't a plain DNS label is rejected before every use.
const SUBDOMAIN_RE = /^[a-z0-9-]{1,63}$/;
export function normalizeSubdomain(value) {
  const sub = String(value ?? "").trim().toLowerCase();
  return SUBDOMAIN_RE.test(sub) ? sub : null;
}

// The ONLY way AppFolio is called. Every request goes through here so no call
// site can forget the Base-Url-Override (without it, Nango's private-api-basic
// template fails hard with base_url_override_not_allowed) or the JSON
// Content-Type (without it, AppFolio returns 406). `body` is always sent.
function appfolioFetch({ connectionId, subdomain, path, query, body = {} }) {
  const sub = normalizeSubdomain(subdomain);
  if (!sub) throw new Error("AppFolio database name (subdomain) is missing or invalid");
  return nangoProxyFetch({
    connectionId,
    providerConfigKey: PROVIDER_CONFIG_KEY,
    path,
    method: "POST",
    query,
    body,
    baseUrlOverride: `https://${sub}.appfolio.com`,
  });
}

// Fetch every row of one report, following next_page_url. Follow-up requests
// must NOT carry filters (v2 rejects them) — only an empty JSON body.
async function fetchReport({ connectionId, subdomain, report, filters }) {
  const rows = [];
  let res = await appfolioFetch({
    connectionId,
    subdomain,
    path: `/api/v2/reports/${report}.json`,
    query: { paginate_results: "true" },
    body: filters ?? {},
  });

  for (let page = 0; ; page += 1) {
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
    if (page >= MAX_PAGES) throw new Error(`AppFolio ${report}: exceeded ${MAX_PAGES} pages`);
    res = await appfolioFetch({
      connectionId,
      subdomain,
      path: String(next).replace(/^https?:\/\/[^/]+/, ""),
    });
  }
}

const pick = (row, ...keys) => {
  for (const k of keys) {
    if (row?.[k] != null && row[k] !== "") return row[k];
  }
  return null;
};

// AppFolio report cells are display-ish values — booleans may arrive as
// "Yes"/"No" strings, visibility as words. Unknown values stay unknown.
const isYes = (v) =>
  v === true || ["yes", "true", "y", "posted"].includes(String(v ?? "").trim().toLowerCase());
const isVisible = (v) =>
  ["visible", "public", "advertised", "listed"].includes(String(v ?? "").trim().toLowerCase());

export async function verifyConnection(connectionId, meta) {
  const sub = normalizeSubdomain(meta?.subdomain);
  if (!sub) return { ok: false, error: "AppFolio database name (subdomain) is missing or invalid" };
  try {
    const res = await appfolioFetch({
      connectionId,
      subdomain: sub,
      path: "/api/v2/reports/unit_directory.json",
      query: { paginate_results: "false" },
    });
    if (!res.ok) return { ok: false, error: `AppFolio returned ${res.status}` };
    return { ok: true, accountLabel: `${sub}.appfolio.com` };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not reach AppFolio" };
  }
}

export async function fetchSnapshot(connectionId, meta) {
  const sub = normalizeSubdomain(meta?.subdomain);
  if (!sub) {
    // Without a valid subdomain nothing can be fetched — return a broken
    // snapshot so the sync refuses to reconcile (never delists on our mistake).
    return { properties: [], errors: ["AppFolio database name (subdomain) is missing or invalid"] };
  }
  const includeAll = meta?.includeAllUnits === true;
  const errors = [];
  const warnings = [];
  const today = new Date().toISOString().slice(0, 10);

  // unit_directory is the identity spine — without it there is no snapshot.
  let unitRows;
  try {
    unitRows = await fetchReport({ connectionId, subdomain: sub, report: "unit_directory" });
  } catch (err) {
    return { properties: [], errors: [err?.message || "unit_directory fetch failed"] };
  }

  // unit_vacancy carries availability. A failure degrades: availability goes
  // unknown (null -> sync takes no action) and the recorded error makes the
  // cron suppress delists for this run.
  let vacancyRows = [];
  try {
    vacancyRows = await fetchReport({ connectionId, subdomain: sub, report: "unit_vacancy" });
  } catch (err) {
    errors.push(`unit_vacancy fetch failed: ${err?.message || "unknown"}`);
  }

  // rent_roll enriches availableFrom with lease end dates (as_of_to is a
  // REQUIRED filter). A failure degrades the same way — never delists.
  let rentRoll = [];
  try {
    rentRoll = await fetchReport({
      connectionId,
      subdomain: sub,
      report: "rent_roll",
      filters: { as_of_to: today },
    });
  } catch (err) {
    errors.push(`rent_roll fetch failed: ${err?.message || "unknown"}`);
  }

  const vacancyByUnit = new Map();
  for (const row of vacancyRows) {
    const unitKey = pick(row, "unit_id", "unit");
    if (unitKey != null) vacancyByUnit.set(String(unitKey), row);
  }

  // Latest lease end per unit. rent_roll column names are unverified vendor
  // territory (brief §7) — tolerate the plausible spellings, never guess dates.
  const leaseEndByUnit = new Map();
  for (const row of rentRoll) {
    const unitKey = pick(row, "unit_id", "unit", "unit_name");
    const end = toIsoDate(pick(row, "lease_to", "lease_end", "lease_end_date", "move_out"));
    if (unitKey == null || !end) continue;
    const key = String(unitKey);
    const prev = leaseEndByUnit.get(key);
    if (!prev || end > prev) leaseEndByUnit.set(key, end);
  }
  // rent_roll's real column names are unverified vendor territory (brief §7).
  // If rows came back but none parsed, log the actual keys so the fix is a
  // one-line rename instead of a debugging session.
  if (rentRoll.length && leaseEndByUnit.size === 0) {
    const keys = Object.keys(rentRoll[0] ?? {}).join(", ");
    console.warn(`[pms/appfolio] rent_roll returned ${rentRoll.length} rows but no recognizable unit/lease-end columns. Actual keys: ${keys}`);
    warnings.push("rent_roll columns unrecognized; lease end dates unavailable this sync");
  }

  const propMap = new Map();
  for (const row of unitRows) {
    const propKey = String(pick(row, "property_id", "property", "property_name") ?? "unknown");
    const unitKey = pick(row, "unit_id", "unit");
    if (unitKey == null) continue;
    const vacancy = vacancyByUnit.get(String(unitKey));
    const leaseEnd = leaseEndByUnit.get(String(unitKey)) ?? null;

    // Availability comes from unit_vacancy's unit_status ("Vacant-Unrented",
    // "Vacant-Rented", "Occupied", "Notice-..."). When the unit has no vacancy
    // row, a current lease from the rent roll still proves it is occupied —
    // that keeps the pre-leasing horizon working. Otherwise: unknown.
    const status = pick(vacancy, "unit_status", "status");
    const statusText = status == null ? null : String(status).toLowerCase();
    let available = null;
    if (statusText != null) available = statusText.startsWith("vacant");
    else if (leaseEnd && leaseEnd >= today) available = false;

    const advertised =
      isYes(pick(row, "posted_to_internet")) ||
      isYes(pick(vacancy, "posted_to_internet")) ||
      isVisible(pick(row, "visibility"));

    // Conservative default: surface only what the landlord advertises or what
    // is actually available. Occupied, unadvertised units stay off Proximity.
    if (!includeAll && !advertised && available !== true) continue;

    if (!propMap.has(propKey)) {
      propMap.set(propKey, {
        externalPropertyId: propKey,
        name: pick(row, "property_name", "property"),
        address: pick(row, "property_address", "unit_address", "address"),
        city: pick(row, "property_city", "unit_city", "city"),
        state: pick(row, "property_state", "unit_state", "state"),
        zip: pick(row, "property_zip", "unit_zip", "zip", "postal_code"),
        description: null,
        units: [],
      });
    }
    // marketing_description is unit-level in AppFolio; keep the longest one as
    // the property's blurb (used only when first creating a listing).
    const marketing = toDescription(pick(row, "marketing_description"));
    const prop = propMap.get(propKey);
    if (marketing && (!prop.description || marketing.length > prop.description.length)) {
      prop.description = marketing;
    }
    propMap.get(propKey).units.push({
      externalUnitId: String(unitKey),
      label: pick(row, "unit_name", "unit"),
      available,
      // Advertised rent is what the landlord shows the world; market rent is
      // the fallback. bed_and_bath (a display string) is deliberately ignored.
      rent: toMoney(pick(row, "advertised_rent", "market_rent", "computed_market_rent") ??
        pick(vacancy, "advertised_rent", "computed_market_rent")),
      bedrooms: toBedrooms(pick(row, "bedrooms", "beds", "br")),
      bathrooms: toBathrooms(pick(row, "bathrooms", "baths", "ba")),
      area: toMoney(pick(row, "sqft", "square_feet", "unit_size") ?? pick(vacancy, "sqft")),
      availableFrom: toIsoDate(pick(vacancy, "available_on")) || (available === false ? leaseEnd : null),
      beds: null,
      rawStatus: status == null ? null : String(status),
    });
  }

  // A property without a street address can't be geocoded or shown — skip it
  // cleanly (warn, don't error: an error would suppress delists account-wide).
  const properties = [];
  for (const prop of propMap.values()) {
    if (!prop.address) {
      console.warn(`[pms/appfolio] skipping property ${prop.externalPropertyId} (${prop.name || "unnamed"}): no address`);
      warnings.push(`property ${prop.externalPropertyId} skipped: no address`);
      continue;
    }
    properties.push(prop);
  }

  return { properties, errors, warnings };
}

export const providerConfigKey = PROVIDER_CONFIG_KEY;
