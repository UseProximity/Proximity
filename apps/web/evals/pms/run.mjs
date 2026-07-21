/*
 * Offline eval for the PMS connector layer (no network, no DB, no Nango account).
 *
 * Stubs global fetch with recorded-style fixtures and asserts the normalization
 * contract every connector must honor:
 *   - status -> available mapping (vacant/occupied/unknown -> true/false/null)
 *   - word-form bedrooms/bathrooms ("TwoBed", "OnePointFiveBath") -> numbers
 *   - rent parsing ("$1,250" -> 1250; junk -> null)
 *   - occupied units get availableFrom from the active lease end (pre-leasing)
 *   - pagination (Buildium offset pages, AppFolio next_page_url)
 *   - broken pulls return { properties: [], errors } — NEVER a partial snapshot
 *   - httpRetry: 429/5xx retried with backoff, 4xx returned as-is
 *
 * Run:  node evals/pms/run.mjs   (from apps/web)
 */
process.env.NANGO_SECRET_KEY = "test-secret";

const WEB = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { fetchWithRetry } = await import("file://" + WEB + "/src/lib/pms/httpRetry.js");
const buildium = await import("file://" + WEB + "/src/lib/pms/buildium.js");
const doorloop = await import("file://" + WEB + "/src/lib/pms/doorloop.js");
const appfolio = await import("file://" + WEB + "/src/lib/pms/appfolio.js");
const { toBedrooms, toBathrooms, toMoney } = await import("file://" + WEB + "/src/lib/pms/types.js");

const results = [];
function check(label, pass, detail = "") {
  results.push({ label, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Route stubbed fetch calls by proxy path. Each test installs its own routes.
let routes = [];
let callLog = [];
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  callLog.push(u);
  for (const [pattern, handler] of routes) {
    if (u.includes(pattern)) return handler(u, options);
  }
  return json({ error: "no fixture for " + u }, 404);
};

// ---------- unit coercions ----------
check("toBedrooms word form", toBedrooms("TwoBed") === 2 && toBedrooms("Studio") === 0);
check("toBedrooms numeric + junk", toBedrooms("3") === 3 && toBedrooms("loft") === null);
check("toBathrooms word form", toBathrooms("OnePointFiveBath") === 1.5);
check("toMoney strips currency", toMoney("$1,250") === 1250 && toMoney("n/a") === null && toMoney(0) === null);

// ---------- Buildium ----------
{
  const page = (rows) => json(rows);
  routes = [
    ["/proxy/v1/rentals/units/listings", () => json([])],
    ["/proxy/v1/rentals/units", (u) =>
      new URL(u).searchParams.get("offset") === "0"
        ? page([
            { Id: 11, PropertyId: 1, UnitNumber: "A", UnitBedrooms: "TwoBed", UnitBathrooms: "OneBath", UnitSize: 800, MarketRent: "1200", IsUnitOccupied: false },
            { Id: 12, PropertyId: 1, UnitNumber: "B", UnitBedrooms: "FourBed", UnitBathrooms: "TwoBath", MarketRent: 2600, IsUnitOccupied: true },
            { Id: 13, PropertyId: 1, UnitNumber: "C", UnitBedrooms: 1, MarketRent: null },
          ])
        : page([])],
    ["/proxy/v1/rentals", (u) =>
      new URL(u).searchParams.get("offset") === "0"
        ? page([{ Id: 1, Name: "Clemens Flats", Address: { AddressLine1: "6633 Clemens Ave", City: "St. Louis", State: "MO", PostalCode: "63130" } }])
        : page([])],
    ["/proxy/v1/leases", (u) =>
      new URL(u).searchParams.get("offset") === "0"
        ? page([{ UnitId: 12, LeaseToDate: "2027-07-31" }])
        : page([])],
  ];

  const snap = await buildium.fetchSnapshot("conn-1");
  const prop = snap.properties[0];
  const [a, b, c] = prop.units;
  check("buildium: property identity + address", prop.externalPropertyId === "1" && prop.address === "6633 Clemens Ave" && prop.zip === "63130");
  check("buildium: vacant unit -> available true + rent", a.available === true && a.rent === 1200 && a.bedrooms === 2 && a.bathrooms === 1);
  check("buildium: occupied unit -> available false + availableFrom from lease end", b.available === false && b.availableFrom === "2027-07-31");
  check("buildium: unknown occupancy -> available null (no action)", c.available === null && c.rent === null);
  check("buildium: no errors on clean pull", snap.errors.length === 0);

  // broken property pull -> refuse to reconcile
  routes = [["/proxy/v1/rentals", () => json({ error: "boom" }, 401)]];
  const broken = await buildium.fetchSnapshot("conn-1");
  check("buildium: auth failure -> empty snapshot + error, never partial", broken.properties.length === 0 && broken.errors.length === 1);
}

// ---------- DoorLoop ----------
{
  routes = [
    ["/proxy/properties", () => json({ data: [{ id: "p1", name: "Skinker House", address: { street1: "6100 Skinker Blvd", city: "St. Louis", state: "MO", zip: "63112" } }] })],
    ["/proxy/units", () => json({ data: [
      { id: "u1", name: "1N", property: "p1", beds: 3, baths: 2, marketRent: 2100, active: true },
      { id: "u2", name: "1S", property: "p1", beds: 3, baths: 2, marketRent: 2100, active: true },
      { id: "u3", name: "base", property: "p1", active: false },
    ] })],
    ["/proxy/leases", () => json({ data: [{ id: "l1", status: "ACTIVE", end: "2027-05-31", units: ["u2"] }] })],
  ];
  const snap = await doorloop.fetchSnapshot("conn-2");
  const [u1, u2, u3] = snap.properties[0].units;
  check("doorloop: unleased unit -> available true", u1.available === true);
  check("doorloop: active lease -> available false + availableFrom", u2.available === false && u2.availableFrom === "2027-05-31");
  check("doorloop: inactive unit -> available false", u3.available === false);

  // lease endpoint down -> occupancy unknown, availability must go null (not true!)
  routes = routes.slice(0, 2).concat([["/proxy/leases", () => json({ error: "x" }, 500)]]);
  const degraded = await doorloop.fetchSnapshot("conn-2");
  check("doorloop: lease fetch failure -> available null + error recorded",
    degraded.properties[0].units[0].available === null && degraded.errors.length === 1);
}

// ---------- AppFolio ----------
{
  const page2 = "https://sub.appfolio.com/api/v2/reports/unit_directory.json?page=2";
  routes = [
    ["unit_directory.json?page=2", () => json({ results: [
      { property_id: "P9", property_name: "Waterman Lofts", property_address: "5500 Waterman Blvd", unit_id: "W2", unit_name: "2E", unit_status: "Occupied", market_rent: "$1,850", bedrooms: 2, bathrooms: 1 },
    ], next_page_url: null })],
    ["unit_directory.json", () => json({ results: [
      { property_id: "P9", property_name: "Waterman Lofts", property_address: "5500 Waterman Blvd", unit_id: "W1", unit_name: "1E", unit_status: "Vacant-Unrented", market_rent: "$1,795", bedrooms: 2, bathrooms: 1 },
    ], next_page_url: page2 })],
    ["rent_roll.json", () => json({ results: [{ unit_id: "W2", lease_to: "2026-12-31" }] })],
  ];
  const snap = await appfolio.fetchSnapshot("conn-3");
  const units = snap.properties[0].units;
  check("appfolio: next_page_url followed (both pages present)", units.length === 2);
  const w1 = units.find((u) => u.externalUnitId === "W1");
  const w2 = units.find((u) => u.externalUnitId === "W2");
  check("appfolio: Vacant-Unrented -> available true + rent parsed", w1.available === true && w1.rent === 1795);
  check("appfolio: Occupied -> available false + lease end from rent roll", w2.available === false && w2.availableFrom === "2026-12-31");
}

// ---------- httpRetry ----------
{
  let attempts = 0;
  routes = [["retry-me", () => {
    attempts++;
    return attempts < 3
      ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } })
      : json({ ok: true });
  }]];
  const res = await fetchWithRetry("https://x.test/retry-me", {}, { baseDelayMs: 1 });
  check("httpRetry: 429 retried until success", res.status === 200 && attempts === 3);

  attempts = 0;
  routes = [["no-retry", () => { attempts++; return json({ error: "bad" }, 400); }]];
  const res400 = await fetchWithRetry("https://x.test/no-retry", {}, { baseDelayMs: 1 });
  check("httpRetry: 4xx returned as-is, not retried", res400.status === 400 && attempts === 1);

  attempts = 0;
  routes = [["flaky", () => { attempts++; return attempts < 2 ? json({}, 503) : json({ ok: true }); }]];
  const res5xx = await fetchWithRetry("https://x.test/flaky", {}, { baseDelayMs: 1 });
  check("httpRetry: 5xx retried", res5xx.status === 200 && attempts === 2);
}

// ---------- credential hygiene ----------
{
  routes = [["/proxy/v1/rentals", () => json([])]];
  callLog = [];
  await buildium.verifyConnection("conn-h");
  const leaked = callLog.some((u) => u.includes("test-secret"));
  check("no secret in URLs (Authorization header only)", !leaked);
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
