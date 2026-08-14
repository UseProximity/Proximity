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
const rentec = await import("file://" + WEB + "/src/lib/pms/rentec.js");
const { toBedrooms, toBathrooms, toMoney, toDescription } = await import("file://" + WEB + "/src/lib/pms/types.js");
const mapping = await import("file://" + WEB + "/src/lib/pms/mapping.js");

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
check("toDescription trims, nulls blanks, caps blobs",
  toDescription("  hi  ") === "hi" && toDescription("   ") === null && toDescription(null) === null &&
  toDescription("x".repeat(6000)).length === 5001);

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
  const META = { subdomain: "acme" };
  const page2 = "https://acme.appfolio.com/api/v2/reports/unit_directory.json?page=2";

  // unit_directory: identity + numeric beds/baths/sqft/rent. W2 lives on page 2.
  // W3 is occupied and NOT advertised (must be excluded by the conservative
  // default). W4 is advertised but has no beds/rent/sqft (nulls must survive)
  // and no vacancy row (occupancy inferred from its current lease).
  // P0 has no address (property must be skipped with a warning, not an error).
  const dirPage1 = [
    { property_id: "P9", property_name: "Waterman Lofts", unit_address: "5500 Waterman Blvd", unit_city: "St. Louis", unit_state: "MO", unit_zip: "63112", unit_id: "W1", unit_name: "1E", advertised_rent: "$1,795", market_rent: "$1,900", bedrooms: 2, bathrooms: "1", sqft: 750, posted_to_internet: "Yes", visibility: "Visible", marketing_description: "Short blurb." },
    { property_id: "P9", property_name: "Waterman Lofts", unit_address: "5500 Waterman Blvd", unit_city: "St. Louis", unit_state: "MO", unit_zip: "63112", unit_id: "W3", unit_name: "3E", market_rent: "$1,700", bedrooms: 1, bathrooms: "1", sqft: 600, posted_to_internet: "No" },
    { property_id: "P9", property_name: "Waterman Lofts", unit_address: "5500 Waterman Blvd", unit_city: "St. Louis", unit_state: "MO", unit_zip: "63112", unit_id: "W4", unit_name: "4E", posted_to_internet: "Yes" },
    { property_id: "P0", property_name: "No Address Flats", unit_id: "X1", unit_name: "1", bedrooms: 2, posted_to_internet: "Yes" },
  ];
  const dirPage2 = [
    { property_id: "P9", property_name: "Waterman Lofts", unit_address: "5500 Waterman Blvd", unit_city: "St. Louis", unit_state: "MO", unit_zip: "63112", unit_id: "W2", unit_name: "2E", market_rent: "$1,850", bedrooms: 2, bathrooms: "1.5", sqft: 900, posted_to_internet: "Yes", marketing_description: "The longer marketing blurb about Waterman Lofts that should win." },
  ];
  // unit_vacancy: availability truth. bed_and_bath is a decoy display string —
  // numbers must come from unit_directory, never from parsing it.
  const vacancy = [
    { unit_id: "W1", unit_status: "Vacant-Unrented", bed_and_bath: "9 bd / 9 ba", rent_ready: "Yes" },
    { unit_id: "W2", unit_status: "Occupied", bed_and_bath: "9 bd / 9 ba" },
    { unit_id: "W3", unit_status: "Occupied" },
    { unit_id: "X1", unit_status: "Vacant-Unrented" },
  ];

  const overrides = [];   // Base-Url-Override header of every proxy call
  let rentRollBody = null;
  let page2Body = null;
  const record = (options) => {
    overrides.push(options?.headers?.["Base-Url-Override"] ?? null);
  };
  routes = [
    ["unit_directory.json?page=2", (u, options) => {
      record(options);
      page2Body = JSON.parse(options.body || "{}");
      return json({ results: dirPage2, next_page_url: null });
    }],
    ["unit_directory.json", (u, options) => {
      record(options);
      return json({ results: dirPage1, next_page_url: page2 });
    }],
    ["unit_vacancy.json", (u, options) => {
      record(options);
      return json({ results: vacancy });
    }],
    ["rent_roll.json", (u, options) => {
      record(options);
      rentRollBody = JSON.parse(options.body || "{}");
      return json({ results: [
        { unit_id: "W2", lease_to: "2026-12-31" },
        { unit_id: "W4", lease_to: "2027-05-31" },
      ] });
    }],
  ];

  const snap = await appfolio.fetchSnapshot("conn-3", META);
  check("appfolio: every call carries the Base-Url-Override",
    overrides.length === 4 && overrides.every((h) => h === "https://acme.appfolio.com"));
  check("appfolio: rent_roll sent the required as_of_to filter",
    /^\d{4}-\d{2}-\d{2}$/.test(rentRollBody?.as_of_to || ""));
  check("appfolio: next_page_url followed with NO filters (empty body)",
    page2Body != null && Object.keys(page2Body).length === 0);

  check("appfolio: no-address property skipped as a warning, not an error",
    snap.properties.length === 1 && snap.errors.length === 0 &&
    (snap.warnings ?? []).length === 1);
  const units = snap.properties[0].units;
  const w1 = units.find((u) => u.externalUnitId === "W1");
  const w2 = units.find((u) => u.externalUnitId === "W2");
  const w3 = units.find((u) => u.externalUnitId === "W3");
  const w4 = units.find((u) => u.externalUnitId === "W4");
  check("appfolio: pagination joined across pages (page-2 unit present)", !!w2);
  check("appfolio: vacancy join -> Vacant-Unrented is available, advertised rent wins",
    w1?.available === true && w1?.rent === 1795);
  check("appfolio: numeric beds/baths from unit_directory, bed_and_bath decoy ignored",
    w1?.bedrooms === 2 && w1?.bathrooms === 1 && w2?.bathrooms === 1.5);
  check("appfolio: Occupied -> available false + availableFrom from rent roll",
    w2?.available === false && w2?.availableFrom === "2026-12-31");
  check("appfolio: occupied unadvertised unit excluded by conservative default", w3 == null);
  check("appfolio: no vacancy row + current lease -> occupied with availableFrom (horizon feed)",
    w4?.available === false && w4?.availableFrom === "2027-05-31");
  check("appfolio: missing beds/rent/sqft pass through as null, never 0",
    w4?.bedrooms === null && w4?.bathrooms === null && w4?.rent === null && w4?.area === null);
  check("appfolio: longest marketing_description becomes the property blurb",
    snap.properties[0].description === "The longer marketing blurb about Waterman Lofts that should win.");

  // includeAllUnits lifts the conservative filter per connection.
  const snapAll = await appfolio.fetchSnapshot("conn-3", { ...META, includeAllUnits: true });
  check("appfolio: includeAllUnits surfaces the occupied unadvertised unit",
    snapAll.properties[0].units.some((u) => u.externalUnitId === "W3"));

  // rent_roll failure must DEGRADE (errors recorded, units intact) so the
  // cron's snapshot.errors guard suppresses delists — never a delist here.
  routes = routes.map(([p, h]) => (p === "rent_roll.json" ? [p, () => json({ error: "boom" }, 400)] : [p, h]));
  const degraded = await appfolio.fetchSnapshot("conn-3", META);
  check("appfolio: rent_roll failure degrades (units kept + error recorded, delists suppressed downstream)",
    degraded.errors.length === 1 && degraded.properties[0]?.units?.length === 3 &&
    degraded.properties[0].units.find((u) => u.externalUnitId === "W2")?.available === false);

  // unit_directory failure = broken pull -> empty snapshot, refuse to reconcile.
  routes = [["unit_directory.json", () => json({ error: "bad credentials" }, 401)]];
  const broken = await appfolio.fetchSnapshot("conn-3", META);
  check("appfolio: unit_directory failure -> empty snapshot + error, never partial",
    broken.properties.length === 0 && broken.errors.length === 1);

  // SSRF guard: bad subdomains are rejected before ANY network call.
  routes = [];
  for (const bad of ["evil.com/", "../", ""]) {
    callLog = [];
    const s = await appfolio.fetchSnapshot("conn-3", { subdomain: bad });
    const v = await appfolio.verifyConnection("conn-3", { subdomain: bad });
    check(`appfolio: subdomain ${JSON.stringify(bad)} rejected with zero network calls`,
      s.properties.length === 0 && s.errors.length === 1 && v.ok === false && callLog.length === 0);
  }
  const noMeta = await appfolio.fetchSnapshot("conn-3");
  check("appfolio: missing meta/subdomain -> broken snapshot, refuse to reconcile",
    noMeta.properties.length === 0 && noMeta.errors.length === 1);
  check("appfolio: normalizeSubdomain trims + lowercases, rejects dots",
    appfolio.normalizeSubdomain("  Acme-1 ") === "acme-1" && appfolio.normalizeSubdomain("a.b") === null);
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

// ---------- demo mode gating ----------
{
  const { isMockConnection, mockSnapshot } = await import("file://" + WEB + "/src/lib/pms/mock.js");
  delete process.env.APP_ENV;
  check("mock: enabled outside production", isMockConnection("mock-demo") === true);
  process.env.APP_ENV = "production";
  check("mock: hard-off in production", isMockConnection("mock-demo") === false);
  delete process.env.APP_ENV;
  const snap = mockSnapshot();
  check("mock: snapshot has demo properties, no errors", snap.properties.length === 3 && snap.errors.length === 0);

  routes = [];
  callLog = [];
  const v = await buildium.verifyConnection("mock-demo");
  check("mock: buildium short-circuits without any network call", v.ok === true && callLog.length === 0);

  process.env.PMS_MOCK_LEASED = "2B";
  const leased = mockSnapshot().properties[0].units.find((u) => u.label === "2B");
  check("mock: PMS_MOCK_LEASED forces a unit occupied", leased.available === false && leased.availableFrom != null);
  delete process.env.PMS_MOCK_LEASED;
}

// ---------- Rentec Direct ----------
{
  const envelope = (data) => json({ summary: { records: Array.isArray(data) ? data.length : 1, timestamp: "2026-07-21T00:00:00Z" }, data });
  routes = [
    ["/proxy/ping", () => envelope({ status: "success", user: { user_id: 7, company: "Delmar Loop Rentals" } })],
    ["/proxy/properties", () => envelope([
      {
        id: "property:100", property_id: 100, sub_of: null, nickname: "DeMun Flats",
        address: "700 DeMun Ave", city: "Clayton", state: "MO", zip: 63105,
        multiplex: true, multiunits: 3, monthly_rent: null, renters: [],
        subunits: [
          { id: "property:101", property_id: 101, sub_of: 100, nickname: "1W", monthly_rent: "1,450",
            renters: [], marketing: { bedrooms: 2, bathrooms: 1, sqft: 900 } },
          { id: "property:102", property_id: 102, sub_of: 100, nickname: "2W", monthly_rent: 1600,
            renters: [{ renter_id: 9, renter_name: "T", move_in: "2025-08-01", move_out: null }],
            marketing: { bedrooms: 2, bathrooms: 1.5, sqft: 950 } },
          { id: "property:103", property_id: 103, sub_of: 100, nickname: "3W", monthly_rent: 1600 },
        ],
      },
      // standalone house = its own single unit
      { id: "property:200", property_id: 200, sub_of: null, nickname: "Kingsbury House",
        address: "6300 Kingsbury Ave", city: "St. Louis", state: "MO", zip: "63130",
        multiplex: false, renters: [{ renter_id: 3, move_in: "2025-06-01", move_out: "2027-05-31" }],
        marketing: { bedrooms: 4, bathrooms: 2, sqft: 1800 } },
      // child row leaked to the top level -> must be skipped, never double-counted
      { id: "property:101", property_id: 101, sub_of: 100, nickname: "1W dup", renters: [] },
    ])],
    ["/proxy/leases", () => envelope([
      { lease_id: 1, property_id: 102, lease_begin: "2025-08-01", lease_end: "2027-07-31", move_out: null },
      { lease_id: 2, property_id: 200, lease_begin: "2025-06-01", lease_end: "2027-05-31", move_out: "2027-05-31" },
    ])],
  ];

  const v = await rentec.verifyConnection("conn-r");
  check("rentec: ping -> account label from company", v.ok === true && v.accountLabel === "Delmar Loop Rentals");

  const snap = await rentec.fetchSnapshot("conn-r");
  check("rentec: subunits become units; leaked child rows skipped",
    snap.properties.length === 2 && snap.properties[0].units.length === 3);
  const [u1, u2, u3] = snap.properties[0].units;
  check("rentec: empty renters -> available true + rent/beds parsed",
    u1.available === true && u1.rent === 1450 && u1.bedrooms === 2 && u1.area === 900);
  check("rentec: current renter -> available false + availableFrom from lease end",
    u2.available === false && u2.availableFrom === "2027-07-31");
  check("rentec: renters absent -> available null (no action)", u3.available === null);
  const house = snap.properties[1];
  check("rentec: standalone property is its own unit, moved-out renter honored",
    house.units.length === 1 && house.units[0].available === false && house.units[0].availableFrom === "2027-05-31");
  check("rentec: no errors on clean pull", snap.errors.length === 0);

  routes = [["/proxy/properties", () => json({ error: "bad key" }, 401)]];
  const broken = await rentec.fetchSnapshot("conn-r");
  check("rentec: auth failure -> empty snapshot + error, never partial",
    broken.properties.length === 0 && broken.errors.length === 1);
}

// ---------- pre-leasing horizon ----------
{
  const { leasingHorizonEnd, unitAvailableWithinHorizon, applyLeasingHorizon,
          rollUpAvailability, rollUpAvailableFrom, groupUnitsToTypes } = mapping;
  const plusMonths = (m) => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };
  const today = new Date().toISOString().slice(0, 10);
  const horizon = leasingHorizonEnd();

  check("horizon: lease ending in 2 months -> available",
    unitAvailableWithinHorizon({ available: false, availableFrom: plusMonths(2) }, horizon) === true);
  check("horizon: lease ending in 3 years -> not available",
    unitAvailableWithinHorizon({ available: false, availableFrom: plusMonths(36) }, horizon) === false);
  check("horizon: occupied with no known end -> not available",
    unitAvailableWithinHorizon({ available: false, availableFrom: null }, horizon) === false);
  check("horizon: unknown occupancy stays unknown",
    unitAvailableWithinHorizon({ available: null }, horizon) === null);

  process.env.PMS_LEASING_HORIZON_MONTHS = "3";
  check("horizon: PMS_LEASING_HORIZON_MONTHS shortens the window",
    unitAvailableWithinHorizon({ available: false, availableFrom: plusMonths(6) }, leasingHorizonEnd()) === false);
  delete process.env.PMS_LEASING_HORIZON_MONTHS;

  // A fully pre-leased building (every lease ends within the horizon) rolls up
  // available with the earliest move-in — it must never read as stale.
  const preLeased = applyLeasingHorizon([
    { externalUnitId: "a", bedrooms: 2, available: false, availableFrom: plusMonths(1), rent: 1200 },
    { externalUnitId: "b", bedrooms: 2, available: false, availableFrom: plusMonths(2), rent: 1250 },
  ], horizon, today);
  check("horizon: fully pre-leased building stays available with earliest move-in",
    rollUpAvailability(preLeased) === true && rollUpAvailableFrom(preLeased) === plusMonths(1));

  // A vacant-now unit reports availableFrom = today, so mixed groups say "now".
  const mixed = applyLeasingHorizon([
    { externalUnitId: "a", bedrooms: 2, available: true, availableFrom: null, rent: 1200 },
    { externalUnitId: "b", bedrooms: 2, available: false, availableFrom: plusMonths(2), rent: 1250 },
  ], horizon, today);
  check("horizon: vacant-now beats a later date in the roll-up",
    rollUpAvailableFrom(mixed) === today);

  const types = groupUnitsToTypes(preLeased);
  check("horizon: ingest groups pre-leased units as an available type",
    types.length === 1 && types[0].type.available === true && types[0].type.leaseAvailability === plusMonths(1));
}

// ---------- one-click availability token ----------
{
  process.env.AUTH_SECRET = "eval-secret";
  const { signAvailabilityToken, verifyAvailabilityToken } =
    await import("file://" + WEB + "/src/lib/availabilityCheck.js");
  const token = signAvailabilityToken("listing-123");
  check("availability token: sign/verify roundtrip",
    verifyAvailabilityToken(token)?.listingId === "listing-123");
  check("availability token: tampered token rejected",
    verifyAvailabilityToken(token.slice(0, -2) + "xx") === null &&
    verifyAvailabilityToken("garbage") === null);
  const expired = signAvailabilityToken("listing-123", Date.now() - 40 * 86400_000);
  check("availability token: expired token rejected", verifyAvailabilityToken(expired) === null);
  // TTL boundary (16 days): valid at +15d, rejected at +17d.
  const t0 = 1_700_000_000_000;
  const tok = signAvailabilityToken("listing-123", t0);
  check("availability token: valid within TTL (15d)",
    verifyAvailabilityToken(tok, t0 + 15 * 86400_000)?.listingId === "listing-123");
  check("availability token: rejected past TTL (17d)",
    verifyAvailabilityToken(tok, t0 + 17 * 86400_000) === null);
  delete process.env.AUTH_SECRET;
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
