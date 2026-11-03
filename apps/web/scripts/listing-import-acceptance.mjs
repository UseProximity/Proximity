/*
 * Acceptance test for the paste-your-website importer.
 *
 * Runs real sites through the real API and checks what came back, so "it works"
 * stops being a matter of reading output and deciding it looks right. Every
 * case is a site somebody actually manages, chosen because it is a DIFFERENT
 * SHAPE of website, not just another address:
 *
 *   mac-100          a company whose buildings each have their own domain, and
 *                    a building with 36 floor plans behind a floor-plans index
 *   mac-dorchester   the same company, a different building, per-apartment rents
 *   keeley-euclid    a company that links to its own summary page first, and a
 *                    building whose plan pages carry a filter widget
 *   single-building  one building, pasted directly, no picker
 *   portal-listing   a listing on a portal, which must import as ONE listing
 *                    rather than a picker full of competitors
 *   many-houses      a landlord with many small houses rather than one building
 *
 * Usage:
 *   node scripts/listing-import-acceptance.mjs              # the three core cases
 *   node scripts/listing-import-acceptance.mjs --all        # every case
 *   node scripts/listing-import-acceptance.mjs --case mac-100
 *   node scripts/listing-import-acceptance.mjs --list       # names and costs, runs nothing
 *
 * How a case runs (since the importer moved to background jobs): the page is
 * read for its properties (/api/landlord/listing-draft), the case's property
 * is imported the way the Add Listing page does it (/api/landlord/import/start,
 * then the batch is polled until its job finishes), and the draft is read back
 * the way "View as Student" shows it (/api/landlord/listings/[id]/preview).
 * The draft is removed afterwards. A picker case stops after the first step.
 *
 * Costs real money: roughly 18 Firecrawl credits and $0.40 of Anthropic usage
 * for a big building, near zero for a small one. --list prints the estimate
 * before you spend it.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.TEST_EMAIL ?? "clocktower-demo@proximity.test";
const PASSWORD = process.env.TEST_PASSWORD ?? "draft-test-2026";

const CASES = {
  "mac-100": {
    tier: "core",
    credits: 20,
    url: "https://www.macapartments.com/",
    target: {
      name: "One Hundred Above the Park",
      address: "100 N Kingshighway Blvd, St. Louis, MO 63108",
      url: "https://www.liveat100.com/",
    },
    expect: {
      minUnits: 30,
      minBedVariety: 4, // studio, 1, 2, 3: the bug that started this
      maxBedrooms: 3, // and nothing above it: 100N307F once published as a 4-bed
      minUnitsWithApartments: 10,
      minPhotos: 5,
      minFloorPlanImages: 10,
      minConcessions: 1,
      leaseTermsRequired: true,
    },
  },
  "mac-dorchester": {
    tier: "core",
    credits: 14,
    url: "https://www.macapartments.com/",
    target: {
      name: "Dorchester",
      address: "665 S Skinker Blvd, St. Louis, MO 63105",
      url: "https://www.dorchesterapartments.com/",
    },
    expect: {
      minUnits: 8,
      minBedVariety: 2,
      minUnitsWithApartments: 5,
      minPhotos: 3,
      minFloorPlanImages: 3,
      leaseTermsRequired: true,
    },
  },
  "keeley-euclid": {
    tier: "core",
    credits: 12,
    url: "https://keeleyproperties.com/find-a-home/",
    target: {
      name: "Lofts at Euclid",
      address: "625 N. Euclid Ave, St. Louis, MO 63108",
      url: "https://keeleyproperties.com/properties/lofts-at-euclid",
    },
    expect: {
      minUnits: 5,
      minBedVariety: 2,
      minUnitsWithApartments: 5,
      minPhotos: 5,
      /*
       * No floor plan diagrams expected, and that is the site being honest
       * rather than the importer failing. This used to demand five, and got
       * them: RentCafe labels the first photo of each plan's carousel
       * "Floor Plan <name>", so the box filled with photographs of kitchens
       * and the test called it a pass. The real diagrams open in a dialog and
       * are not images on the page. Mac's two buildings do publish theirs, and
       * their cases still require them.
       */
      minConcessions: 1,
      /*
       * It does publish its terms, and for a long time this said it did not.
       * The apply link was matched on the word "oleapplication", which no
       * RentCafe site uses, so Keeley's whole portfolio imported with four
       * empty lease-term rows. Every plan page links to its rental-options
       * page, which states the term beside the rent.
       */
      leaseTermsRequired: true,
    },
  },
  "keeley-vivienne": {
    tier: "core",
    credits: 20,
    url: "https://keeleyproperties.com/find-a-home/",
    target: {
      name: "Vivienne",
      address: "211 N. Meramec Ave., St. Louis, MO 63105",
      url: "https://keeleyproperties.com/properties/vivienne",
    },
    /*
     * A fourth shape again. Its plans live at /floor-plan/eden while the index
     * is /floor-plans, one letter apart, which found nothing at all; it calls
     * its apartments "Unit 311 Starting From $2,300" rather than
     * "Apartment: #311"; and some plans are waitlist-only with no price.
     *
     * No lease lengths are expected, and this one really is unreadable rather
     * than merely missed: Vivienne publishes no floor-plan pages of its own, so
     * its only leasing links are RentCafe portal shells that render "Loading
     * application..." and reveal a term only after a unit is chosen inside the
     * app. Verified 19 September. The import says so in its notes.
     */
    expect: {
      minUnits: 10,
      minBedVariety: 2,
      minUnitsWithApartments: 8,
      minPhotos: 3,
      leaseTermsRequired: false,
    },
  },
  "single-building": {
    tier: "breadth",
    credits: 6,
    url: "https://www.metroflatsstl.com/",
    expect: { minUnits: 1, minPhotos: 1 },
  },
  "portal-listing": {
    tier: "breadth",
    credits: 3,
    url: "https://www.apartments.com/4721-mcpherson-ave-saint-louis-mo/m97nb7l/",
    /*
     * A portal page must come back as ONE listing, never as a picker of
     * whatever else the portal was advertising alongside it.
     *
     * A PORTAL LISTING CAN DIE, and this case has already caught one doing it:
     * apartments.com answers a delisted property with a redirect to the city
     * search page, and reading 0 units off a search page is the importer being
     * right, not wrong. If this case fails, open the URL yourself before
     * treating it as a regression: a dead URL and a broken importer look
     * identical from here.
     */
    expect: { minUnits: 1, maxProperties: 0 },
  },
  "many-houses": {
    tier: "breadth",
    credits: 4,
    url: "https://byroncompany.com/apartments",
    // a landlord with many small houses: the picker must offer them, and must
    // not quietly fold most of them away
    expect: { minProperties: 10 },
  },
};

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};

async function login() {
  const { chromium } = await import(
    "/Users/benflicker/course-runner/node_modules/playwright/index.mjs"
  );
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addCookies([
    { name: "staging_email_to", value: "test@proximity.test", domain: "localhost", path: "/" },
  ]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.locator('input[type="email"]').pressSequentially(EMAIL, { delay: 8 });
  await page.locator('input[type="password"]').pressSequentially(PASSWORD, { delay: 8 });
  await page.click('button:has-text("Continue with Email")');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 200000 });
  const cookies = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  await browser.close();
  return cookies;
}

/*
 * Checks every import has to pass, whatever the site. These are the faults that
 * actually reached a landlord during this work, each one now a test:
 * a bedroom count taken out of an image file name, a floor plan that is only a
 * name, per-apartment rents that do not line up with the apartments they price,
 * and a unit shape the database refuses.
 */
function universalProblems(listing) {
  const problems = [];
  for (const [i, u] of (listing.units ?? []).entries()) {
    const where = `unit ${i + 1} (${u.title ?? "untitled"})`;
    if (u.bedrooms != null && (u.bedrooms < 0 || u.bedrooms > 20))
      problems.push(`${where}: ${u.bedrooms} bedrooms is not a home`);
    if (u.bathrooms != null && (u.bathrooms < 0 || u.bathrooms > 20))
      problems.push(`${where}: ${u.bathrooms} bathrooms is not a home`);
    const named = (u.unitNames ?? []).length;
    if (named === 0 && u.bedrooms == null && u.rent == null && u.area == null)
      problems.push(`${where}: a name and nothing else`);
    const rents = (u.unitRents ?? []).length;
    if (rents && rents !== named)
      problems.push(`${where}: ${rents} rents for ${named} apartments, so they cannot be matched up`);
    const dates = (u.unitAvailability ?? []).length;
    if (dates && dates !== named)
      problems.push(`${where}: ${dates} dates for ${named} apartments`);
  }
  /*
   * The same floor plan twice is always wrong, and it is how the worst kind of
   * fault shows up: Dorchester returned ten units on one run and twenty on the
   * next, the extra ten being copies whose names differed only by a hyphen.
   * Nothing above would have caught it (every unit was individually fine), and
   * a nightly sync would have seen the building's unit count flapping.
   */
  const byTitle = new Map();
  for (const u of listing.units ?? []) {
    const key = String(u.title ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!key) continue;
    byTitle.set(key, (byTitle.get(key) ?? 0) + 1);
  }
  for (const [key, n] of byTitle) {
    if (n > 1) problems.push(`floor plan "${key}" came back ${n} times`);
  }
  return problems;
}

function check(name, listing, properties, expect, seconds) {
  const problems = universalProblems(listing ?? { units: [] });
  const units = listing?.units ?? [];
  const beds = new Set(units.map((u) => u.bedrooms).filter((b) => b != null));
  // The preview has no apartment names; the read's summary counts apartments.
  const withApts = listing?.apartments ?? units.filter((u) => (u.unitNames ?? []).length > 0).length;
  const plans = units.filter((u) => u.floorPlanImageUrl).length;
  const e = expect ?? {};

  const want = (cond, msg) => { if (!cond) problems.push(msg); };
  if (e.minProperties) want(properties.length >= e.minProperties,
    `expected at least ${e.minProperties} properties in the picker, got ${properties.length}`);
  if (e.maxProperties != null) want(properties.length <= e.maxProperties,
    `expected no picker, got ${properties.length} properties`);
  if (e.minUnits) {
    want(!!listing, "no listing came back at all");
    want(units.length >= e.minUnits, `expected at least ${e.minUnits} units, got ${units.length}`);
  }
  if (e.maxBedrooms != null) want(Math.max(...beds, 0) <= e.maxBedrooms,
    `a ${Math.max(...beds, 0)}-bedroom came back and this building has nothing above ${e.maxBedrooms}`);
  if (e.minBedVariety) want(beds.size >= e.minBedVariety,
    `expected at least ${e.minBedVariety} different bedroom counts, got ${beds.size} (${[...beds].sort().join(", ")})`);
  if (e.minUnitsWithApartments) want(withApts >= e.minUnitsWithApartments,
    `expected at least ${e.minUnitsWithApartments} units with their apartments read, got ${withApts}`);
  if (e.minPhotos) want((listing?.imageUrls ?? []).length >= e.minPhotos,
    `expected at least ${e.minPhotos} photos, got ${(listing?.imageUrls ?? []).length}`);
  if (e.minFloorPlanImages) want(plans >= e.minFloorPlanImages,
    `expected at least ${e.minFloorPlanImages} floor plan diagrams, got ${plans}`);
  if (e.minConcessions) want((listing?.concessions ?? []).length >= e.minConcessions,
    `expected a rent special, got none`);
  if (e.leaseTermsRequired) want(units.some((u) => (u.leaseTermMonths ?? []).length),
    "no unit came back with a lease length");
  want(seconds < 290, `took ${seconds}s, and the platform stops at 300`);

  return problems;
}

/* The case's property from the picker: its name or street, else the only one. */
function pickProperty(properties, target) {
  const norm = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (target) {
    const street = norm(String(target.address ?? "").split(",")[0]);
    const hit = properties.find((p) => (target.name && norm(p.name) === norm(target.name)) || (street && norm(p.address).startsWith(street)));
    if (hit) return hit;
    throw new Error(`the picker did not offer ${target.name ?? target.address}`);
  }
  if (properties.length !== 1) throw new Error(`expected one property to import, the page offered ${properties.length}`);
  return properties[0];
}

/*
 * Import one property as the Add Listing page does and read the draft back,
 * shaped the way check() reads it. The draft is removed afterwards.
 */
async function importOne(cookies, pastedUrl, property) {
  const headers = { "Content-Type": "application/json", Cookie: cookies };
  const start = await fetch(`${BASE}/api/landlord/import/start`, {
    method: "POST", headers, body: JSON.stringify({ pastedUrl, targets: [property] }),
  });
  const started = await start.json();
  if (!start.ok || !started.batchId) throw new Error(`import/start HTTP ${start.status} ${JSON.stringify(started).slice(0, 160)}`);
  let job = null;
  const until = Date.now() + 10 * 60 * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 5000));
    const b = await (await fetch(`${BASE}/api/landlord/import/batches/${started.batchId}`, { headers })).json();
    job = (b.batch?.jobs ?? b.jobs ?? [])[0] ?? null;
    if (job && ["done", "failed", "cancelled"].includes(job.status)) break;
  }
  if (!job || job.status !== "done") throw new Error(`the import ${job ? `ended ${job.status}: ${job.error ?? job.step}` : "never finished"}`);
  try {
    const p = await (await fetch(`${BASE}/api/landlord/listings/${job.listing_id}/preview`, { headers })).json();
    const l = p.listing ?? p;
    return {
      seconds: job.result?.seconds ?? null,
      summary: job.result?.summary ?? null,
      listing: {
        units: (l.unitTypes ?? []).map((u) => ({
          title: u.name, bedrooms: u.bedrooms, bathrooms: u.bathrooms, rent: u.rent, area: u.area,
          floorPlanImageUrl: u.floorPlanImageUrl, leaseTermMonths: u.leaseTermMonths ?? [],
        })),
        imageUrls: l.images ?? [],
        concessions: l.concessions ?? [],
        apartments: job.result?.summary?.apartments ?? 0,
      },
    };
  } finally {
    // Remove the test draft (a draft this import made, never an existing listing).
    await fetch(`${BASE}/api/landlord/import/jobs/${job.id}`, { method: "DELETE", headers }).catch(() => {});
  }
}

async function run(name, cookies) {
  const c = CASES[name];
  const started = Date.now();
  let res, data;
  try {
    res = await fetch(`${BASE}/api/landlord/listing-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({ url: c.url }),
      signal: AbortSignal.timeout(295000),
    });
    data = await res.json();
    if (res.ok && !c.expect?.minProperties) {
      const imported = await importOne(cookies, c.url, pickProperty(data.properties ?? [], c.target));
      data = { ...data, listing: imported.listing, summary: imported.summary, readSeconds: imported.seconds };
    }
  } catch (err) {
    console.log(`FAIL  ${name}: the request itself failed: ${err.message}`);
    return false;
  }
  // A background read is judged on its own run time, not the polling around it.
  const seconds = data?.readSeconds ?? Math.round((Date.now() - started) / 1000);
  if (!res.ok) {
    console.log(`FAIL  ${name}: HTTP ${res.status} ${JSON.stringify(data).slice(0, 160)}`);
    console.log(`      If this says "something went wrong", read the server log: an Anthropic`);
    console.log(`      balance of zero and a real parsing bug look identical from out here.`);
    return false;
  }
  const u = data.listing?.units ?? [];
  const properties = data.properties ?? [];
  // --dump <dir> keeps the whole draft, so a surprise can be read afterwards
  // instead of costing another import to see.
  const dumpDir = arg("--dump");
  if (dumpDir) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(dumpDir, { recursive: true });
    writeFileSync(`${dumpDir}/${name}.json`, JSON.stringify(data, null, 2));
    console.log(`      (draft written to ${dumpDir}/${name}.json)`);
  }
  const problems = check(name, data.listing, properties, c.expect, seconds);
  /*
   * The bed sizes themselves, not just how many there are: "4 bed sizes" reads
   * the same whether they are 0/1/2/3 or 0/1/2/4, and a four-bedroom that does
   * not exist is the bug this case was written for. A picker case has no units
   * to describe, so it reports what it is actually judged on.
   */
  const sizes = [...new Set(u.map((x) => x.bedrooms).filter((b) => b != null))].sort((a, b) => a - b);
  const line = c.expect?.minProperties
    ? `${properties.length} properties offered, ${seconds}s`
    : `${u.length} units, ` +
      `beds ${sizes.join("/") || "none"}, ` +
      `${data.listing?.apartments ?? 0} apartments, ` +
      `${(data.listing?.imageUrls ?? []).length} photos, ` +
      `${u.filter((x) => x.floorPlanImageUrl).length} plans, ` +
      `${(data.listing?.concessions ?? []).length} specials, ` +
      `${properties.filter((p) => p.alreadyListed).length} already listed, ${seconds}s`;
  if (problems.length) {
    console.log(`FAIL  ${name}: ${line}`);
    for (const p of problems) console.log(`      - ${p}`);
    return false;
  }
  console.log(`PASS  ${name}: ${line}`);
  return true;
}

const only = arg("--case");
const all = process.argv.includes("--all");
const names = only
  ? [only]
  : Object.keys(CASES).filter((n) => all || CASES[n].tier === "core");

if (process.argv.includes("--list")) {
  let total = 0;
  for (const [n, c] of Object.entries(CASES)) {
    total += c.credits;
    console.log(`  ${n.padEnd(16)} ${c.tier.padEnd(8)} ~${c.credits} credits  ${c.url}`);
  }
  console.log(`\n  everything: ~${total} Firecrawl credits, and roughly $2 of Anthropic usage.`);
  process.exit(0);
}

const cookies = await login();
console.log(`Running ${names.length} case(s) against ${BASE}\n`);
const results = [];
for (const n of names) results.push(await run(n, cookies));
const passed = results.filter(Boolean).length;
console.log(`\n${passed} of ${results.length} passed.`);
process.exit(passed === results.length ? 0 : 1);
