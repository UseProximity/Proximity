/*
 * Fake Nango + AppFolio, for rehearsing the landlord flow without an AppFolio account.
 *
 * AppFolio has no free developer sandbox (PMS_APPFOLIO_BRIEF.md §2), so the only way to
 * exercise the real connector before a live landlord connects is to impersonate the
 * upstream. This server speaks Nango's proxy protocol, so pointing the app at it needs
 * NO production code change — just NANGO_HOST:
 *
 *   node apps/web/evals/pms/fake-appfolio.mjs            # terminal 1
 *   NANGO_HOST=http://localhost:4010 \
 *   NANGO_SECRET_KEY=fake NANGO_APPFOLIO_KEY=appfolio \
 *   npm run dev:web                                       # terminal 2
 *
 * Then drive /api/landlord/pms/discover with any connectionId and a subdomain.
 *
 * What this DOES rehearse: the whole server-side path — appfolio.js pagination and
 * next_page_url following, the Base-Url-Override contract, the 406-without-JSON quirk,
 * rent_roll's required as_of_to filter, unit_vacancy joining, column-name parsing,
 * geocoding, radius filtering, dedupe, confirm, ingest, the nightly sync and the digest.
 *
 * What it does NOT: Nango's hosted Connect widget (the browser SDK always talks to Nango
 * Cloud), and the real shape of a real AppFolio account's reports. Those two need Nango
 * dev and a real landlord respectively — see the README.
 *
 * Flags:
 *   --port <n>        listen port (default 4010)
 *   --weird-columns   rename rent_roll's columns to something the connector does not
 *                     recognize, to prove the "columns unrecognized" warning reaches
 *                     the digest instead of silently dropping lease end dates
 *   --fail <report>   make one report 500, to prove a degraded pull never delists
 */
import { createServer } from "http";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(value("--port", 4010));
const WEIRD_COLUMNS = flag("--weird-columns");
const FAIL_REPORT = value("--fail", null);

// Real WashU-area addresses so the discover step's Mapbox geocoding and radius
// filter do real work. "Gateway Tower" sits downtown to exercise the
// outside-the-radius branch.
const PROPERTIES = [
  { id: "CT-100", name: "Clocktower on Delmar", address: "6300 Delmar Blvd", city: "University City", state: "MO", zip: "63130" },
  { id: "CT-200", name: "Clocktower Kingsbury", address: "6100 Kingsbury Ave", city: "St. Louis", state: "MO", zip: "63112" },
  { id: "CT-300", name: "Gateway Tower", address: "1010 Market St", city: "St. Louis", state: "MO", zip: "63101" },
];

const prop = (p) => ({
  property_id: p.id,
  property_name: p.name,
  unit_address: p.address,
  unit_city: p.city,
  unit_state: p.state,
  unit_zip: p.zip,
});

// unit_directory carries identity + the numeric truth (beds/baths/sqft/rent).
// Page 1 / page 2 split so next_page_url following is genuinely exercised.
const DIRECTORY_PAGE_1 = [
  { ...prop(PROPERTIES[0]), unit_id: "CT-100-1A", unit_name: "1A", advertised_rent: "$1,450", market_rent: "$1,500", bedrooms: 2, bathrooms: "1", sqft: 820, posted_to_internet: "Yes", marketing_description: "Two bedroom on Delmar, steps from the Loop." },
  { ...prop(PROPERTIES[0]), unit_id: "CT-100-2A", unit_name: "2A", advertised_rent: "$1,495", bedrooms: 2, bathrooms: "1", sqft: 820, posted_to_internet: "Yes" },
  // Occupied AND not advertised — the conservative default must exclude it.
  { ...prop(PROPERTIES[0]), unit_id: "CT-100-3A", unit_name: "3A", market_rent: "$1,400", bedrooms: 1, bathrooms: "1", sqft: 640, posted_to_internet: "No" },
  { ...prop(PROPERTIES[1]), unit_id: "CT-200-1", unit_name: "Unit 1", advertised_rent: "$2,300", bedrooms: 4, bathrooms: "2", sqft: 1500, posted_to_internet: "Yes" },
  { ...prop(PROPERTIES[2]), unit_id: "CT-300-PH", unit_name: "PH", advertised_rent: "$3,100", bedrooms: 2, bathrooms: "2", sqft: 1200, posted_to_internet: "Yes" },
];

// Advertised but with every numeric field missing — nulls must survive rather than
// becoming zeros, and it has no vacancy row so occupancy comes from its lease.
const DIRECTORY_PAGE_2 = [
  { ...prop(PROPERTIES[1]), unit_id: "CT-200-2", unit_name: "Unit 2", posted_to_internet: "Yes" },
];

const VACANCY = [
  { unit_id: "CT-100-1A", unit_status: "Vacant-Unrented", bed_and_bath: "9 bd / 9 ba", rent_ready: "Yes" },
  { unit_id: "CT-100-2A", unit_status: "Vacant-Rented", bed_and_bath: "9 bd / 9 ba" },
  { unit_id: "CT-100-3A", unit_status: "Occupied" },
  { unit_id: "CT-200-1", unit_status: "Occupied" },
  { unit_id: "CT-300-PH", unit_status: "Vacant-Unrented" },
];

// Lease ends drive availableFrom, so a pre-leased unit reads as available-later
// rather than stale. Column names here are the guess the connector makes; the
// --weird-columns flag renames them to prove the warning path.
const RENT_ROLL = [
  { unit_id: "CT-100-2A", lease_to: "2027-07-31", tenant: "Redacted" },
  { unit_id: "CT-100-3A", lease_to: "2027-05-31", tenant: "Redacted" },
  { unit_id: "CT-200-1", lease_to: "2027-08-15", tenant: "Redacted" },
];
const RENT_ROLL_WEIRD = RENT_ROLL.map((r) => ({
  UnitIdentifier: r.unit_id,
  LeaseExpiration: r.lease_to,
  Occupant: r.tenant,
}));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({ __unparsable: raw });
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const body = await readBody(req);

  // --- Nango: mint a Connect session token -----------------------------------
  if (url.pathname === "/connect/sessions" && req.method === "POST") {
    log("connect/sessions ->", JSON.stringify(body.allowed_integrations ?? []));
    return send(res, 200, {
      data: { token: "fake-connect-session-token", expires_at: new Date(Date.now() + 1800_000).toISOString() },
    });
  }

  // --- Nango: connection metadata --------------------------------------------
  if (url.pathname.startsWith("/connection/")) {
    return send(res, 200, { connection_id: url.pathname.split("/")[2], connection_config: {} });
  }

  // --- Nango: proxy to "AppFolio" ---------------------------------------------
  if (url.pathname.startsWith("/proxy/")) {
    const override = req.headers["base-url-override"];
    const contentType = req.headers["content-type"];
    const report = url.pathname.split("/").pop().replace(".json", "");

    // Nango's private-api-basic template has a placeholder base_url, so a call
    // that forgets the override would hit https://my-private-api in production.
    // Fail it here the same way rather than letting the rehearsal pass.
    if (!override) {
      log("REJECT", report, "missing Base-Url-Override");
      return send(res, 400, { error: { code: "base_url_override_not_allowed" } });
    }
    if (!/^https:\/\/[a-z0-9-]+\.appfolio\.com$/.test(override)) {
      log("REJECT", report, "bad override:", override);
      return send(res, 400, { error: { code: "invalid_base_url_override", override } });
    }
    // Real AppFolio returns 406 without a JSON content type.
    if (!contentType || !contentType.includes("application/json")) {
      log("REJECT", report, "missing JSON Content-Type -> 406");
      return send(res, 406, { error: "Not Acceptable" });
    }

    if (FAIL_REPORT && report === FAIL_REPORT) {
      log("FAIL (simulated)", report, "-> 500");
      return send(res, 500, { error: "simulated upstream failure" });
    }

    const page = url.searchParams.get("page");
    const filters = Object.keys(body || {}).filter((k) => k !== "__unparsable");

    if (report === "unit_directory") {
      if (page === "2") {
        // Follow-up page requests must carry no filters — v2 rejects them.
        if (filters.length) {
          log("REJECT unit_directory page 2 carried filters:", filters.join(","));
          return send(res, 400, { error: "filters not allowed on paginated follow-up" });
        }
        log("unit_directory page 2 ->", DIRECTORY_PAGE_2.length, "rows");
        return send(res, 200, { results: DIRECTORY_PAGE_2, next_page_url: null });
      }
      const next = `${override}/api/v2/reports/unit_directory.json?page=2`;
      log("unit_directory page 1 ->", DIRECTORY_PAGE_1.length, "rows, next_page_url set");
      return send(res, 200, { results: DIRECTORY_PAGE_1, next_page_url: next });
    }

    if (report === "unit_vacancy") {
      log("unit_vacancy ->", VACANCY.length, "rows");
      return send(res, 200, { results: VACANCY, next_page_url: null });
    }

    if (report === "rent_roll") {
      // as_of_to is a REQUIRED filter on this report.
      if (!filters.includes("as_of_to")) {
        log("REJECT rent_roll missing as_of_to filter");
        return send(res, 400, { error: "as_of_to is required" });
      }
      const rows = WEIRD_COLUMNS ? RENT_ROLL_WEIRD : RENT_ROLL;
      log("rent_roll ->", rows.length, "rows", WEIRD_COLUMNS ? "(UNRECOGNIZED column names)" : "");
      return send(res, 200, { results: rows, next_page_url: null });
    }

    log("unknown report:", report);
    return send(res, 404, { error: `unknown report ${report}` });
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  log(`fake Nango + AppFolio listening on http://localhost:${PORT}`);
  log(`  rent_roll columns : ${WEIRD_COLUMNS ? "UNRECOGNIZED (warning path)" : "recognized"}`);
  if (FAIL_REPORT) log(`  simulated failure : ${FAIL_REPORT} -> 500`);
  log(`  point the app at it with NANGO_HOST=http://localhost:${PORT}`);
});
