/*
 * Read a landlord's website into a snapshot.
 *
 * Two entry points:
 *
 *   discoverSite(url)       what the pasted page is: a PMS portal to steer to,
 *                           a list of properties for the picker, or one
 *                           property (then its snapshot is returned too)
 *   readProperty(target)    one property, read to the apartment where the site
 *                           allows, as a snapshot the writer can apply
 *
 * The order of work inside readProperty is deliberate. Deterministic readers
 * go first and own the numbers: the SightMap feed on RealPage sites, Entrata's
 * floor plan cards, RentCafe's floor plan pages, a small landlord's per-unit
 * pages. The model (Haiku, Sonnet when Haiku is unsure) is then asked for
 * what needs reading rather than parsing: the description, amenities, which
 * photos are the building's, and, only on a site no reader understood, the
 * units themselves. The same function serves the first import and the weekly
 * sync, so a sync sees exactly what an import would.
 */
import {
  fetchPageSmart,
  tryRenderPage,
  renderPageWaited,
  renderPage,
  htmlToText,
  extractImageCandidates,
  extractLinks,
  extractAllLinks,
  normalizeLinkUrl,
  extractJsonLd,
  extractSiteBrand,
  detectPmsPortal,
  isListingPortal,
  findPropertyOwnSite,
  hostOf,
  SYNCABLE_PMS,
  sameSite,
  DraftFetchError,
  readCounters,
  setSharedPageCache,
  extractDocumentLinks,
} from "@/lib/listingDraft/fetchSite";
import { pageCacheStore } from "./pageCache.js";
import { isDocumentUrl, readDocument } from "./readers/document.js";

// Every read shares fetched pages with the rest of its batch
// (IMPORT_PAGE_CACHE=0 turns it off, for measuring or debugging).
if (process.env.IMPORT_PAGE_CACHE !== "0") setSharedPageCache(pageCacheStore);
import {
  SIGHTMAP_HINT_RE,
  findSightmapEmbed,
  fetchSightmapInventory,
} from "@/lib/listingDraft/sightmap";
import {
  findFloorPlanPages,
  chooseFloorPlansToRead,
  fetchFloorPlanUnits,
} from "@/lib/listingDraft/floorPlanUnits";
import { ENTRATA_HINT_RE, parseEntrataFloorPlans } from "./readers/entrata.js";
import { findLeaseTerms } from "@/lib/listingDraft/floorPlanUnits";
import { findFlyerCandidates, readInclusionsFlyer } from "./readers/flyer.js";
import { sanitizeDescription } from "./sanitize.js";
import { EMBEDDED_HINT_RE, parseEmbeddedFloorPlans } from "./readers/rentcafeEmbedded.js";
import { G5_HINT_RE, findG5Urns, fetchG5Locations, fetchG5Inventory } from "./readers/g5.js";
import { parseEmbeddedProperties } from "./readers/embeddedProperties.js";
import { findSecureCafe, readSecureCafe } from "./readers/securecafe.js";
import { confirmFloorPlans } from "./readers/floorPlanVision.js";
import { ZILLOW_HOST_RE, parseZillowGallery } from "./readers/zillow.js";
import { readWithModel, sortPhotosByUnit, choosePagesToExplore, reviewNotes, judgeSamePlan } from "./model.js";
import { isoDate, makeSnapshot, money, num, unitKey } from "./snapshot.js";

export { DraftFetchError };

// Display names for PMS portals named in landlord-facing messages.
export const PMS_DISPLAY = {
  propertyware: "Propertyware",
  showmojo: "ShowMojo",
  rentcafe: "RentCafe",
  appfolio: "AppFolio",
  buildium: "Buildium",
  rentecdirect: "Rentec Direct",
  doorloop: "DoorLoop",
};

const LISTINGS_LINK_RE = /listing|apartment|rent|avail|propert|floor|unit|home|residen/i;
const THIN_TEXT_CHARS = 800;
// The page a single building keeps its actual units on.
const FLOORPLAN_LINK_RE =
  /floor[\s_-]*plans?|availabilit|available\s+(units|apartments)|rates\s*(and|&)?\s*floor|pricing\s*(and|&)?\s*floor/i;
// A management company's "see everything" link.
const INVENTORY_LINK_RE =
  /search\s*(listing|apartment|rental|propert|home)|\b(all|our|available|browse)\s+(propert|listing|rental|apartment|communit|home)|find\s+(a\s+|your\s+)?(home|apartment|rental)|\bvacanc/i;
// A page per apartment, the small-landlord shape.
const UNIT_PAGE_LINK_RE = /\b(unit|apt|apartment|suite|residence|flat)s?\b|floor[\s_-]*plan|\b\d\s*(bed|br|bd)\b/i;
const UNIT_PAGE_CAP = 6;
const LINK_CAP = 140;
const IMAGE_CAP = 120;

// ---------------------------------------------------------------- helpers

class Crawl {
  constructor() {
    this.pages = []; // [{ url, text }] for the model, first = main
    this.fetched = []; // raw fetched pages, same order
    this.imageMap = new Map(); // url -> { alt, pages:Set }
    this.links = [];
  }
  structureOf(fetched) {
    return fetched.linkHtml ?? fetched.html;
  }
  entry(fetched) {
    const jsonLd = extractJsonLd(fetched.html);
    return {
      url: fetched.finalUrl,
      text: htmlToText(fetched.html) + (jsonLd ? `\n\nSTRUCTURED DATA (JSON-LD):\n${jsonLd}` : ""),
    };
  }
  addImages(fetched, pageNum) {
    for (const im of extractImageCandidates(this.structureOf(fetched), fetched.finalUrl)) {
      const cur = this.imageMap.get(im.url);
      if (cur) {
        cur.pages.add(pageNum);
        if (!cur.alt && im.alt) cur.alt = im.alt;
      } else {
        this.imageMap.set(im.url, { alt: im.alt, pages: new Set([pageNum]) });
      }
    }
  }
  add(fetched) {
    this.pages.push(this.entry(fetched));
    this.fetched.push(fetched);
    this.addImages(fetched, this.pages.length);
    this.mergeLinks(fetched);
    return fetched;
  }
  replaceMain(fetched) {
    this.pages[0] = this.entry(fetched);
    this.fetched[0] = fetched;
    this.imageMap.clear();
    this.fetched.forEach((f, i) => this.addImages(f, i + 1));
    this.links = [];
    this.fetched.forEach((f) => this.mergeLinks(f));
  }
  mergeLinks(fetched) {
    const seen = new Set(this.links.map((l) => l.url));
    this.links = [
      ...this.links,
      ...extractAllLinks(this.structureOf(fetched), fetched.finalUrl, LINK_CAP).filter((l) => !seen.has(l.url)),
      // Linked files and embedded frames, from the page as served (frames
      // are stripped from its text), for the page hunt to choose.
      ...extractDocumentLinks(fetched.html, fetched.finalUrl).filter((l) => !seen.has(l.url)),
    ].slice(0, LINK_CAP * 2);
  }
  has(url) {
    return this.fetched.some((f) => f.finalUrl === url);
  }
  async follow(url) {
    if (!url) return null;
    // Already read: hand back the page rather than nothing, so a floor plans
    // link that points at the page we are on still counts as found.
    if (this.has(url)) return this.fetched.find((f) => f.finalUrl === url) ?? null;
    if (isDocumentUrl(url)) return this.readFile(url);
    try {
      const sub = await fetchPageSmart(url);
      if (this.has(sub.finalUrl)) return sub;
      return this.add(sub);
    } catch (err) {
      // A link that turned out to be a PDF or a picture.
      if (err?.code === "document") return this.readFile(url);
      return null;
    }
  }
  /* A linked file, read into text (readers/document.js); four per read. */
  async readFile(url) {
    if ((this.filesRead ?? 0) >= 4) return null;
    this.filesRead = (this.filesRead ?? 0) + 1;
    const doc = await readDocument(url);
    if (!doc) return null;
    this.fileCost = (this.fileCost ?? 0) + doc.cost;
    return this.add(doc.page);
  }
  /*
   * Image candidates taken from every page rather than the first two, the
   * front page first and a bigger share, so room photos on the plan pages
   * further down the list still get offered.
   */
  images(cap = IMAGE_CAP) {
    const byPage = new Map();
    for (const [url, v] of this.imageMap) {
      const page = Math.min(...v.pages);
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push({ url, alt: v.alt, pages: [...v.pages].sort() });
    }
    const pages = [...byPage.keys()].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; out.length < cap; i++) {
      let addedAny = false;
      for (const page of pages) {
        const list = byPage.get(page);
        const take = i === 0 && page === pages[0] ? 12 : 1;
        for (let k = 0; k < take && out.length < cap; k++) {
          const next = list.shift();
          if (!next) break;
          out.push(next);
          addedAny = true;
        }
      }
      if (!addedAny) break;
    }
    return out;
  }
  textLength() {
    return this.pages.reduce((n, p) => n + p.text.length, 0);
  }
}

// A picked property's URL is fetched, so it has to be one the landlord's own
// site actually points at: same-site, or linked from the page we read.
function resolveTargetUrl(rawUrl, pastedUrl, pageUrl, pageLinks) {
  const url = normalizeLinkUrl(rawUrl, pageUrl);
  if (!url) return null;
  if (sameSite(url, pastedUrl)) return url;
  return pageLinks.some((l) => l.url === url) ? url : null;
}

function inventoryGroups(links, properties, pageUrl) {
  const taken = new Set(properties.map((p) => p.url).filter(Boolean));
  return links
    .filter((l) => l.internal && l.url !== pageUrl && !taken.has(l.url) && INVENTORY_LINK_RE.test(`${l.text} ${l.url}`))
    .slice(0, 2)
    .map((l) => ({ name: "All properties on your website", address: "", url: l.url, kind: "group", source: "inventory" }));
}

/*
 * "6219-6221 Rosebury Ave" is two buildings, and the database stores them
 * that way (one listing per street address). A site that markets a range as
 * one page still gets one picker row per number, each pointing at the same
 * page; the read then keeps only the floor plans carrying its number.
 */
const RANGE_RE = /^\s*(\d{1,6})\s*[-\u2013\/&]\s*(?:and\s*)?(\d{1,6})\s+(.+)$/;
function splitAddressRange(entry) {
  const m = String(entry.address || entry.name || "").match(RANGE_RE);
  if (!m) return [entry];
  const [, a, b, rest] = m;
  const lo = Number(a);
  const hi = Number(b);
  // Only a short run of numbers is a pair of buildings; "100-400 Main" is a block.
  if (!(hi > lo) || hi - lo > 8 || !/[A-Za-z]/.test(rest)) return [entry];
  const numbers = [lo, hi];
  const numberedName = (n) => (RANGE_RE.test(entry.name ?? "") ? `${n} ${entry.name.match(RANGE_RE)[3]}` : `${n} ${rest.split(",")[0]}`);
  return numbers.map((n) => ({ ...entry, name: numberedName(n), address: `${n} ${rest}` }));
}

const withScheme = (raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

// ---------------------------------------------------------------- readers

/* SightMap inventory -> raw units, one offer per apartment and per term price. */
function unitsFromSightmap(inv) {
  const byPlan = new Map();
  for (const u of inv.units) {
    if (!byPlan.has(u.planId)) byPlan.set(u.planId, []);
    byPlan.get(u.planId).push(u);
  }
  const units = [];
  for (const list of byPlan.values()) {
    const f = list[0];
    const offers = [];
    for (const u of list) {
      const apartments = u.unitNumber ? [String(u.unitNumber)] : [];
      const terms = u.planTerms ?? (u.leaseTerm ? [num(String(u.leaseTerm).match(/\d+/)?.[0])].filter(Boolean) : []);
      if (u.termPricing?.length) {
        for (const o of u.termPricing) {
          if (o.price == null) continue;
          offers.push({ rent: o.price, rentIsPerPerson: false, leaseTermMonths: [o.months], availableFrom: u.availableOn, apartments });
        }
      } else {
        offers.push({ rent: u.price, rentIsPerPerson: false, leaseTermMonths: terms, availableFrom: u.availableOn, apartments });
      }
    }
    units.push({
      name: f.planName,
      bedrooms: f.bedrooms,
      bathrooms: f.bathrooms,
      area: Math.max(...list.map((u) => u.area ?? 0)) || null,
      floorPlanImageUrl: f.floorPlanImageUrl,
      available: true,
      photos: [],
      offers,
    });
  }
  return units;
}

/* RentCafe-style floor plan pages -> raw units. */
function unitsFromFloorPlans(result) {
  const { plans, termRange } = result;
  const reflects = Number(termRange?.reflects) || null;
  const houseTerms = (termRange?.offered ?? []).length ? termRange.offered : reflects ? [reflects] : [];
  return plans.map((p) => {
    const terms = (p.leaseTermMonths ?? []).length ? p.leaseTermMonths : houseTerms;
    const offers = p.apartments.map((a) => ({
      rent: a.rent,
      rentIsPerPerson: false,
      leaseTermMonths: terms,
      availableFrom: a.availableOn === "now" ? null : a.availableOn,
      apartments: a.number ? [a.number] : [],
    }));
    return {
      name: p.name,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      area: p.area,
      floorPlanImageUrl: p.image ?? null,
      available: !p.waitlist,
      photos: [],
      offers,
    };
  });
}

/* Model units -> raw units. */
/*
 * The pasted address. A landlord may paste their availability PDF or Google
 * Sheet itself rather than a page that links to it: read it as a file.
 */
async function fetchMain(url) {
  if (isDocumentUrl(url)) {
    const doc = await readDocument(url);
    if (doc) return doc.page;
    throw new DraftFetchError("document_unreadable");
  }
  try {
    return await fetchPageSmart(url);
  } catch (err) {
    if (err?.code !== "document") throw err;
    const doc = await readDocument(url);
    if (doc) return doc.page;
    throw new DraftFetchError("document_unreadable");
  }
}

// Links never worth opening while hunting for a building's facts.
const SKIP_LINK_RE = /^mailto:|^tel:|facebook\.com|instagram\.com|twitter\.com|\/\/x\.com|linkedin\.com|tiktok\.com|youtube\.com|pinterest\.|google\.[a-z.]+\/maps|maps\.apple|logout|log-out|sign-?out|\.(zip|docx?|xlsx?)(\?|$)/i;

/*
 * What the read knows and does not know about the building yet, stated
 * from the data itself (not guessed), for the model choosing pages to open
 * and for the notes review. Missing means a student would see a blank.
 */
export function factsAbout({ units = [], flyers = [], listing = null, readerNotes = [] }) {
  // What the platform readers reported in words (a portal's monthly fees,
  // its lease-term range) is known too.
  const known = [...readerNotes];
  const missing = [];
  const offers = units.flatMap((u) => u.offers ?? []);
  if (!units.length) {
    missing.push("the floor plans or apartments and their rents");
    missing.push("lease lengths offered");
    missing.push("when apartments are available");
  } else {
    known.push(`${units.length} floor plan${units.length === 1 ? "" : "s"}: ${units.slice(0, 15).map((u) => `${u.name ?? "unnamed"} (${u.bedrooms ?? "?"} bed, ${u.bathrooms ?? "?"} bath)`).join("; ")}${units.length > 15 ? "; ..." : ""}`);
    const priced = offers.filter((o) => o.rent != null).length;
    const termed = offers.filter((o) => (o.leaseTermMonths ?? []).length).length;
    const dated = offers.filter((o) => o.availableFrom || o.availableNow).length;
    const terms = [...new Set(offers.flatMap((o) => o.leaseTermMonths ?? []))].sort((a, b) => a - b);
    if (priced) known.push(`rent for ${priced} of ${offers.length} lease${offers.length === 1 ? "" : "s"}`);
    if (priced < offers.length || !offers.length) missing.push(`rent for ${offers.length ? offers.length - priced : "every"} lease${offers.length - priced === 1 ? "" : "s"}`);
    if (termed) known.push(`lease lengths ${terms.join(", ")} months on ${termed} of ${offers.length} leases`);
    if (termed < offers.length || !offers.length) missing.push(`lease lengths offered${termed ? ` for ${offers.length - termed} lease${offers.length - termed === 1 ? "" : "s"}` : ""}`);
    if (dated) known.push(`an availability date (or "available now") on ${dated} of ${offers.length} leases`);
    if (dated < offers.length || !offers.length) missing.push(`when apartments are available${dated ? ` for ${offers.length - dated} lease${offers.length - dated === 1 ? "" : "s"}` : ""}`);
  }
  const utilities = [...new Set([...(listing?.utilities_included ?? []), ...flyers.flatMap((f) => f.utilities ?? [])])];
  if (utilities.length) known.push(`utilities included in rent: ${utilities.join(", ")}`);
  else missing.push("which utilities, if any, the rent includes");
  if (flyers.length) known.push(`a "what's included" or fee flyer was read (${flyers.map((f) => f.url).join(", ")})`);
  return { known, missing };
}

function unitsFromModel(listing) {
  return (listing?.units ?? []).map((u) => {
    const perPerson = u.rentBasis === "per_person";
    const apartments = (u.apartments ?? []).map((a) => String(a).trim()).filter(Boolean);
    const rents = (u.apartmentRents ?? []).length === apartments.length ? u.apartmentRents : null;
    const dates = (u.apartmentDates ?? []).length === apartments.length ? u.apartmentDates : null;
    const offers = apartments.length
      ? apartments.map((a, i) => ({
          rent: rents ? rents[i] : u.rent,
          rentIsPerPerson: perPerson,
          leaseTermMonths: u.leaseTermMonths ?? [],
          availableFrom: dates ? dates[i] : u.availableFrom,
          apartments: [a],
        }))
      : [{ rent: u.rent, rentIsPerPerson: perPerson, leaseTermMonths: u.leaseTermMonths ?? [], availableFrom: u.availableFrom, apartments: [] }];
    return {
      name: u.name,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      area: u.area,
      floorPlanImageUrl: u.floorPlanImageUrl,
      available: u.available !== false,
      photos: [],
      offers: offers.filter((o) => o.rent != null || o.apartments.length),
      rentUnknown: u.rentBasis === "unknown" && u.rent != null,
    };
  });
}

/*
 * The model's units fill the gaps in the reader's: bed and bath counts the
 * plan page did not print, matched by name and then by size.
 */
/*
 * One key for a floor plan's name across sources: SightMap says "Unit 04",
 * the portal "04", the website "Plan 04".
 */
export const planKey = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\b(floor\s*plan|floorplan|plan|unit|the|apartment|apt)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

/* Same layout: equal beds and baths, sizes within 2 sq ft. */
const sameLayout = (a, b) =>
  a.bedrooms != null && a.bedrooms === b.bedrooms && Number(a.bathrooms) === Number(b.bathrooms) && a.area && b.area && Math.abs(a.area - b.area) <= 2;

/*
 * One entry per floor plan. Two entries with the same name (after "Unit",
 * "Plan" and punctuation are set aside) are one plan, their leases pooled.
 * Two with different names are different plans, even with the same beds,
 * baths and size: the Barton's Musial and Cassily are both 1 bed, 1 bath,
 * 750 sq ft, at different rents. Only when the two come from different
 * sources (a feed and the website, or two feeds), where one plan can be
 * listed under two names, does the model look at both (drawings included)
 * and decide. An entry with no name and the same layout is a duplicate.
 */
function mergeInto(twin, u) {
  const have = new Set(twin.offers.flatMap((o) => o.apartments ?? []));
  for (const o of u.offers ?? []) {
    const apts = o.apartments ?? [];
    if (apts.length ? apts.some((a) => !have.has(a)) : !twin.offers.some((t) => t.rent === o.rent)) twin.offers.push(o);
  }
  twin.floorPlanImageUrl ??= u.floorPlanImageUrl;
  if (!(twin.photos ?? []).length && (u.photos ?? []).length) twin.photos = u.photos;
  twin.available = twin.available !== false || u.available !== false;
}

export async function dedupeLayouts(units, { judge = judgeSamePlan } = {}) {
  const out = [];
  for (const u of units) {
    const named = planKey(u.name);
    let twin = named ? out.find((o) => planKey(o.name) === named) : null;
    if (!twin) {
      for (const o of out.filter((x) => sameLayout(x, u))) {
        if (!named || !planKey(o.name)) {
          twin = o;
          break;
        }
        if ((o.source ?? "website") === (u.source ?? "website")) continue;
        const verdict = await judge(o, u);
        console.log(`[source-import] same plan? "${o.name}" (${o.source ?? "website"}) and "${u.name}" (${u.source ?? "website"}): ${verdict.same ? "yes" : "no"}, ${verdict.reason}`);
        if (verdict.same) {
          twin = o;
          break;
        }
      }
    }
    if (twin) mergeInto(twin, u);
    else out.push(u);
  }
  return out;
}

async function fillFromModel(readerUnits, modelUnits) {
  const norm = planKey;
  const used = new Set();
  for (const ru of readerUnits) {
    const i = modelUnits.findIndex(
      (mu, n) =>
        !used.has(n) &&
        (ru.name && mu.name ? norm(ru.name) === norm(mu.name) : !!(ru.area && mu.area && Math.abs(ru.area - mu.area) <= 2))
    );
    if (i < 0) continue;
    used.add(i);
    const mu = modelUnits[i];
    ru.bedrooms ??= mu.bedrooms;
    ru.bathrooms ??= mu.bathrooms;
    ru.area ??= mu.area;
    ru.floorPlanImageUrl ??= mu.floorPlanImageUrl;
    if (!ru.offers.length && mu.offers.length) ru.offers = mu.offers;
    // Lease lengths and dates the plan page did not carry but the site's text
    // did (an FAQ, a pricing page): lent to every offer still missing them.
    const terms = mu.offers.find((o) => (o.leaseTermMonths ?? []).length)?.leaseTermMonths ?? [];
    const date = mu.offers.find((o) => o.availableFrom)?.availableFrom ?? null;
    for (const o of ru.offers) {
      if (!(o.leaseTermMonths ?? []).length && terms.length) o.leaseTermMonths = terms;
      if (!o.availableFrom && date && !o.apartments?.length) o.availableFrom = date;
    }
  }
  /*
   * Plans the website shows that no feed carried: a plan with nothing free
   * right now ("Call for details", a waitlist) is missing from a feed of
   * available apartments but is still a floor plan of the building.
   */
  const extra = modelUnits.filter((mu, n) => !used.has(n)).map((mu) => ({ ...mu, source: "the website's text" }));
  return dedupeLayouts([...readerUnits, ...extra]);
}

// ---------------------------------------------------------------- discovery

/*
 * What the pasted URL is. Returns one of:
 *   { kind: "pms", pms }
 *   { kind: "error", code, status, message }
 *   { kind: "properties", sourceUrl, properties: [{ name, address, url, kind }] }
 *   { kind: "property", sourceUrl, snapshot, properties }
 */
export function discoverSite(args) {
  // The picker's own counters, with a lower render ceiling than a building.
  return readCounters.run({ render: {}, cache: {}, cap: Number(process.env.IMPORT_PICKER_RENDER_CAP) > 0 ? Number(process.env.IMPORT_PICKER_RENDER_CAP) : 20 }, () => discoverSiteInner(args));
}

async function discoverSiteInner({ url: rawUrl, skipPmsSteer = false, readSingle = false, onStep = () => {} }) {
  const pastedUrl = withScheme(rawUrl.trim());
  const pastedPortal = detectPmsPortal(pastedUrl);
  if (!skipPmsSteer && pastedPortal && SYNCABLE_PMS.has(pastedPortal)) {
    return { kind: "pms", pms: pastedPortal };
  }

  onStep("Reading your website");
  const crawl = new Crawl();
  let main;
  try {
    main = await fetchMain(pastedUrl);
  } catch (err) {
    if (err instanceof DraftFetchError) return { kind: "error", code: err.code };
    throw err;
  }
  crawl.add(main);

  /*
   * A G5-hosted site names its company and building in the page. The
   * inventory service lists every building the company has, with addresses
   * and each one's own website, which beats rendering a location-finder
   * widget and asking a model to read the cards. A building's own site is
   * one property; the corporate site (whose "location" is the head office,
   * absent from the list) is the list.
   */
  if (G5_HINT_RE.test(main.html)) {
    const { client, location } = findG5Urns(main.html);
    const locations = client ? await fetchG5Locations(client) : null;
    if (locations?.length) {
      const own = location ? locations.find((l) => l.g5LocationUrn === location) : null;
      if (own) {
        onStep("Reading the property");
        return { kind: "single", sourceUrl: main.finalUrl, property: { ...own, url: main.finalUrl }, properties: [] };
      }
      console.log(`[source-import] g5: ${locations.length} buildings for ${client}`);
      return { kind: "properties", sourceUrl: main.finalUrl, properties: locations.map((l) => ({ name: l.name, address: l.address, url: l.url, kind: "property" })) };
    }
  }

  /*
   * A property list embedded as JSON (Mac's search page): every building
   * with its address and coordinates, nearest to campus first. The
   * homepage usually hides this behind a "Search Apartments" link, so that
   * link is tried too.
   */
  {
    let embedded = parseEmbeddedProperties(main.html, main.finalUrl);
    if (!embedded) {
      const inv = crawl.links.find((l) => l.internal && l.url !== main.finalUrl && (INVENTORY_LINK_RE.test(`${l.text} ${l.url}`) || /\/search\b/i.test(l.url)));
      const page = inv ? await crawl.follow(inv.url) : null;
      if (page) embedded = parseEmbeddedProperties(page.html, page.finalUrl);
    }
    if (embedded?.length) {
      console.log(`[source-import] embedded property list: ${embedded.length} buildings (nearest ${embedded[0].name}, ${embedded[0].distanceKm ?? "?"} km)`);
      // distanceKm rides along: the picker places a building by it when it has one.
      return { kind: "properties", sourceUrl: main.finalUrl, properties: embedded };
    }
  }

  const linkedPortal = detectPmsPortal(main.finalUrl, main.html);
  if (linkedPortal && (skipPmsSteer || !SYNCABLE_PMS.has(linkedPortal)) && crawl.pages[0].text.length < 3000) {
    const rendered = await tryRenderPage(main.finalUrl);
    if (rendered && htmlToText(rendered.html).length > crawl.pages[0].text.length) {
      main = rendered;
      crawl.replaceMain(main);
    }
  }

  /*
   * A page whose list of buildings is drawn by a script after load: Mills'
   * "Our Properties" is 616 characters of footer until a location finder has
   * fetched its data, then 5,000 characters naming every building with its
   * address and its own website. One waited render, only when the quick
   * reads came back this thin.
   */
  if (crawl.pages[0].text.length < 1500) {
    const waited = await renderPageWaited(main.finalUrl);
    if (waited && htmlToText(waited.html).length > crawl.pages[0].text.length * 1.5) {
      console.log(`[source-import] waited render of ${main.finalUrl}: ${htmlToText(waited.html).length} chars`);
      main = waited;
      crawl.replaceMain(main);
    }
  }

  // A thin marketing shell: follow up to two links that look like listings.
  if (crawl.pages[0].text.length < THIN_TEXT_CHARS) {
    const followUrls = crawl.links.filter((l) => LISTINGS_LINK_RE.test(`${l.url} ${l.text}`) && l.url !== main.finalUrl).slice(0, 2);
    for (const l of followUrls) await crawl.follow(l.url);
  }

  const portalResponse = () => {
    if (!linkedPortal) return null;
    if (!skipPmsSteer && SYNCABLE_PMS.has(linkedPortal)) return { kind: "pms", pms: linkedPortal };
    return {
      kind: "error",
      code: "pms_widget",
      message: `Your listings appear to live inside ${PMS_DISPLAY[linkedPortal] ?? "your property-management system"}, which we can't read from your website. You can still fill out the form manually.`,
    };
  };

  if (crawl.textLength() < 200) {
    return portalResponse() ?? { kind: "error", code: "no_text" };
  }

  onStep("Finding your properties");
  const portalPage = isListingPortal(main.finalUrl);
  const brandName = extractSiteBrand(main.html);
  let { draft } = await readWithModel({
    pages: crawl.pages,
    images: crawl.images(60),
    links: portalPage ? [] : crawl.links,
    targetProperty: null,
    brandName,
    discover: true,
  });

  const draftEmpty = (d) => !d || (!d.listing && (d.properties ?? []).length === 0);
  // Nothing on an un-rendered page: the content only exists after JS runs.
  if (draftEmpty(draft)) {
    const rendered = await tryRenderPage(main.finalUrl);
    if (rendered && htmlToText(rendered.html).length > crawl.pages[0].text.length) {
      main = rendered;
      crawl.replaceMain(main);
      ({ draft } = await readWithModel({ pages: crawl.pages, images: crawl.images(60), links: crawl.links, targetProperty: null, brandName, discover: true }));
    }
  }
  // Still nothing, but the page points at the site's inventory: follow it once.
  if (draftEmpty(draft)) {
    const onward = inventoryGroups(crawl.links, [], main.finalUrl)[0];
    if (onward && (await crawl.follow(onward.url))) {
      ({ draft } = await readWithModel({ pages: crawl.pages, images: crawl.images(60), links: crawl.links, targetProperty: null, brandName, discover: true }));
    }
  }
  if (!draft) return portalResponse() ?? { kind: "error", code: "unreadable" };

  const properties = portalPage ? [] : (draft.properties ?? []).filter((p) => p.kind !== "group" || p.url);
  if (draft.listing) {
    const looksLikeUrl = (t) => /^(https?:\/\/|www\.)|\.(com|org|net|co)\b/i.test(String(t ?? ""));
    const title = draft.listing.title && !looksLikeUrl(draft.listing.title) ? draft.listing.title : null;
    // A building's own site names the building in its brand ("Everly on the
    // Loop"); an address-shaped title is the model falling back.
    const brand = extractSiteBrand(main.html);
    const addressLike = (t) => /^\s*\d+\s+\S/.test(String(t ?? ""));
    const name = title && !addressLike(title) ? title : brand && !looksLikeUrl(brand) ? brand : title ?? draft.listing.address ?? pastedUrl;
    const single = { name, address: draft.listing.address ?? "", url: main.finalUrl, kind: "property" };
    const split = splitAddressRange(single);
    if (split.length > 1) return { kind: "properties", sourceUrl: main.finalUrl, properties: [...split, ...properties] };
    // The picker only needs to know it is one property; the job reads it.
    if (!readSingle) return { kind: "single", sourceUrl: main.finalUrl, property: single, properties };
    // One property on the page: read it fully.
    const snapshot = await readProperty({
      pastedUrl,
      target: { name: draft.listing.title ?? draft.listing.address ?? pastedUrl, address: draft.listing.address ?? "", url: main.finalUrl, levelUrl: null },
      onStep,
      _crawl: crawl,
      _brandName: brandName,
      _modelDraft: draft.listing,
    });
    return { kind: "property", sourceUrl: main.finalUrl, snapshot, properties };
  }
  if (!properties.length) {
    if (portalPage) return { kind: "error", code: "portal_gone", site: hostOf(main.finalUrl).replace(/^www\./, "") };
    return portalResponse() ?? { kind: "error", code: "no_properties" };
  }
  const expanded = properties.flatMap((p) => (p.kind === "group" ? [p] : splitAddressRange(p)));
  return {
    kind: "properties",
    sourceUrl: main.finalUrl,
    properties: [...expanded, ...inventoryGroups(crawl.links, expanded, main.finalUrl)],
  };
}

// ---------------------------------------------------------------- property

/*
 * One property, read as far as the site allows. `target` is what the picker
 * (or the monitor) knows: { name, address, url, levelUrl }. url is the
 * property's own page when there is one; levelUrl is the company page it was
 * listed on, which is where we start when there is no url.
 *
 * onStep(text) is called as the read moves, for the workspace's progress line.
 */
export function readProperty(args) {
  // Its own credit counters, whatever else runs beside it.
  return readCounters.run({ render: {}, cache: {} }, () => readPropertyInner(args));
}

async function readPropertyInner({ pastedUrl: rawPasted, target, onStep = () => {}, knownPortal = null, _crawl = null, _brandName = null, _modelDraft = null }) {
  const pastedUrl = withScheme(String(rawPasted ?? target.levelUrl ?? target.url).trim());
  const startUrl = withScheme(String(target.levelUrl ?? pastedUrl).trim());
  const notes = [];
  const crawl = _crawl ?? new Crawl();
  let main = crawl.fetched[0] ?? null;
  let modelCost = 0;

  if (!main) {
    onStep("Reading your website");
    main = await fetchMain(startUrl); // throws DraftFetchError
    crawl.add(main);
  }
  const brandName = _brandName ?? extractSiteBrand(main.html);

  // The property's own page, then its own website if the company page only
  // points at it (Keeley's buildings each have one), then its floor plans.
  let propPage = main;
  let floorPlanIndex = null;
  let targetUrl = target.url ? resolveTargetUrl(target.url, pastedUrl, main.finalUrl, crawl.links) : null;
  /*
   * A building's own website that the company page never links to in plain
   * HTML (the inventory feed named it, or a widget would have). It is still
   * worth opening, on one condition: the page has to name the property.
   * That is what keeps a mis-resolved link from importing the wrong building.
   */
  let unverified = null;
  if (!targetUrl && target.url) {
    const url = normalizeLinkUrl(target.url, main.finalUrl);
    if (url && !isListingPortal(url) && !detectPmsPortal(url)) unverified = url;
  }
  console.log(`[source-import] ${target.name}: start ${startUrl}, target ${targetUrl ?? unverified ?? "(none)"}${unverified ? " (unlinked, will verify)" : ""}`);
  if ((targetUrl ?? unverified) && (targetUrl ?? unverified) !== main.finalUrl) {
    onStep(`Opening ${target.name}`);
    const page = await crawl.follow(targetUrl ?? unverified);
    if (page && unverified) {
      const text = htmlToText(page.html).toLowerCase();
      const words = String(target.name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !["apartments", "apartment", "the", "and"].includes(w));
      const number = String(target.address ?? "").match(/^\s*(\d{2,6})\b/)?.[1];
      const named = (words.length && words.filter((w) => text.includes(w)).length >= Math.min(2, words.length)) || (number && text.includes(number));
      if (named) targetUrl = unverified;
      else console.log(`[source-import] ${target.name}: ${unverified} does not name the property, ignored`);
    }
    if (page && targetUrl) propPage = page;
    else if (!page) console.log(`[source-import] ${target.name}: could not open ${targetUrl ?? unverified}`);
  }
  if (propPage) {
    const ownSite = findPropertyOwnSite(crawl.structureOf(propPage), propPage.finalUrl, target.name);
    if (ownSite) {
      const ownPage = await crawl.follow(ownSite);
      if (ownPage && htmlToText(ownPage.html).length > 300) {
        console.log(`[source-import] ${target.name}: following its own site ${hostOf(ownPage.finalUrl)}`);
        propPage = ownPage;
      }
    }
    const fp = extractAllLinks(crawl.structureOf(propPage), propPage.finalUrl, LINK_CAP).find(
      (l) => l.internal && l.url !== propPage.finalUrl && FLOORPLAN_LINK_RE.test(`${l.text} ${l.url}`)
    );
    if (fp) {
      onStep("Reading floor plans");
      floorPlanIndex = await crawl.follow(fp.url) ?? crawl.fetched.find((f) => f.finalUrl === fp.url) ?? null;
    }
    console.log(
      `[source-import] ${target.name}: property page ${propPage.finalUrl} (${htmlToText(propPage.html).length} chars), ` +
        `floor plans ${floorPlanIndex ? floorPlanIndex.finalUrl : fp ? `link ${fp.url} failed` : "no link found"}`
    );
    // Which other pages to open (FAQ, fees, availability, a leasing
    // portal) is the model's choice, made below once the readers have said
    // what they found (explore()).
  }

  // A small landlord's page per apartment, only the ones carrying this
  // property's street number when a number is known.
  if (!targetUrl || targetUrl === main.finalUrl) {
    const readable = (l) => {
      try {
        return `${l.text} ${decodeURIComponent(l.url)}`;
      } catch {
        return `${l.text} ${l.url}`;
      }
    };
    let unitLinks = crawl.links.filter((l) => l.internal && !crawl.has(l.url) && UNIT_PAGE_LINK_RE.test(readable(l)));
    const number = `${target.address ?? ""} ${target.name ?? ""}`.match(/\b\d{2,6}\b/)?.[0];
    if (number) unitLinks = unitLinks.filter((l) => new RegExp(`\\b${number}\\b`).test(readable(l)));
    if (unitLinks.length) onStep("Reading unit pages");
    for (const l of unitLinks.slice(0, UNIT_PAGE_CAP)) await crawl.follow(l.url);
  }

  // ---- deterministic readers, in order of fidelity
  let platform = "generic";
  let readerUnits = [];
  let confidence = "low";

  // 0. G5 inventory service (Mills and other G5-hosted estates).
  let g5Concessions = [];
  {
    // The building's pages were fetched after the company's, so try the
    // URNs from the last page back: the corporate site names the head
    // office, which has no floor plans, and must not win over the building.
    const urns = [...new Set([...crawl.fetched].reverse().map((f) => (G5_HINT_RE.test(f.html) ? findG5Urns(f.html).location : null)).filter(Boolean))];
    for (const location of urns) {
      onStep("Reading live availability");
      const inv = await fetchG5Inventory(location, { vlsHost: crawl.fetched.map((f) => f.html?.match(/"vlsHost"\s*:\s*"(https?:[^"]+)"/)?.[1]).find(Boolean) });
      if (!inv) continue;
      {
        platform = "g5";
        readerUnits = inv.units.map((u) => ({ ...u, source: "the G5 feed" }));
        g5Concessions = inv.concessions;
        notes.push(...inv.notes);
        confidence = "high";
        console.log(`[source-import] g5 inventory ${location}: ${inv.units.length} plans, ${inv.apartments} apartments`);
        break;
      }
    }
  }

  // 1. SightMap feed (RealPage estates).
  if (!readerUnits.length) {
    let token = null;
    for (const f of crawl.fetched) {
      token = findSightmapEmbed(f.html);
      if (token) break;
    }
    if (!token) {
      const candidate = crawl.fetched.find((f) => SIGHTMAP_HINT_RE.test(f.html));
      if (candidate) {
        onStep("Reading live availability");
        const waited = await renderPageWaited(candidate.finalUrl);
        token = waited ? findSightmapEmbed(waited.html) : null;
      }
    }
    if (token) {
      onStep("Reading live availability");
      const inv = await fetchSightmapInventory(token);
      if (inv?.units?.length) {
        platform = "sightmap";
        readerUnits = unitsFromSightmap(inv).map((u) => ({ ...u, source: "the SightMap feed" }));
        confidence = "high";
        console.log(`[source-import] sightmap: ${inv.units.length} apartments on ${readerUnits.length} plans`);
      }
    }
  }

  // 2. A floor plan feed embedded in the page (Mac's Storyblok site).
  let embeddedConcessions = [];
  if (!readerUnits.length) {
    for (const f of crawl.fetched) {
      if (!EMBEDDED_HINT_RE.test(f.html)) continue;
      const parsed = parseEmbeddedFloorPlans(f.html);
      if (!parsed) continue;
      platform = "rentcafe-embedded";
      readerUnits = parsed.units.map((u) => ({ ...u, source: "the floor plan data in the page" }));
      embeddedConcessions = parsed.concessions;
      notes.push(...parsed.notes);
      confidence = "high";
      console.log(`[source-import] embedded floor plans on ${f.finalUrl}: ${parsed.units.length} plans`);
      break;
    }
  }

  // 2b. The SecureCafe leasing portal behind a RentCafe site: every apartment
  // with its price, date and special, and the lease terms behind each. It
  // outranks the embedded feed for offers; the feed keeps the diagrams,
  // photos and sizes for the plans it also knows.
  let learned = null;
  {
    const portal = crawl.fetched.map((f) => findSecureCafe(f.html)).find(Boolean);
    if (portal) {
      const sc = await readSecureCafe(portal, { known: knownPortal?.propertyId === portal.propertyId ? knownPortal : null, onStep });
      if (sc?.units?.length) {
        const norm = planKey;
        const byName = new Map(readerUnits.map((u) => [norm(u.name), u]));
        for (const u of sc.units) {
          const e = byName.get(norm(u.name));
          if (!e) continue;
          u.floorPlanImageUrl ??= e.floorPlanImageUrl;
          u.area ??= e.area;
          u.bedrooms ??= e.bedrooms;
          u.bathrooms ??= e.bathrooms;
          if (!(u.photos ?? []).length) u.photos = e.photos ?? [];
        }
        platform = readerUnits.length ? `${platform}+securecafe` : "securecafe";
        // The portal's apartments win where both list them; plans and
        // apartments only another reader found (SightMap, the website's own
        // feed) are kept, not dropped.
        readerUnits = await dedupeLayouts([...sc.units.map((u) => ({ ...u, source: "the leasing portal" })), ...readerUnits]);
        embeddedConcessions = [...new Set([...embeddedConcessions, ...sc.concessions])];
        notes.push(...sc.notes);
        confidence = "high";
        learned = sc.learned;
        console.log(`[source-import] securecafe ${portal.host}/${portal.slug}: ${sc.units.length} plans, ${sc.apartments} apartments, ${sc.quoted} quoted, ${sc.reused} reused from the last read`);
      }
    }
  }

  // 3. Entrata floor plan cards.
  if (!readerUnits.length) {
    const page = crawl.fetched.find((f) => ENTRATA_HINT_RE.test(f.html) && parseEntrataFloorPlans(f.html, f.finalUrl));
    const parsed = page ? parseEntrataFloorPlans(page.html, page.finalUrl) : null;
    if (parsed) {
      platform = "entrata";
      readerUnits = parsed.units.map((u) => ({ ...u, source: "the floor plan data in the page" }));
      notes.push(...parsed.notes);
      confidence = "high";
      console.log(`[source-import] entrata: ${parsed.units.length} plans`);
    }
  }

  // 4. RentCafe-style floor plan pages, one level below the index.
  if (!readerUnits.length && floorPlanIndex) {
    const planUrls = findFloorPlanPages(crawl.structureOf(floorPlanIndex), floorPlanIndex.finalUrl);
    console.log(`[source-import] ${target.name}: ${planUrls.length} floor plan pages under ${floorPlanIndex.finalUrl}`);
    if (planUrls.length) {
      onStep(`Reading ${Math.min(planUrls.length, 16)} floor plan pages`);
      const result = await fetchFloorPlanUnits(chooseFloorPlansToRead(planUrls));
      if (result.plans.length) {
        platform = "rentcafe";
        readerUnits = unitsFromFloorPlans(result).map((u) => ({ ...u, source: "the floor plan pages" }));
        confidence = "high";
        if (result.termRange?.min) {
          notes.push(`This building quotes lease terms from ${result.termRange.min} to ${result.termRange.max} months and publishes one rate per apartment. Check the term before you publish.`);
        }
        console.log(`[source-import] floor plans: ${result.plans.length} plans, ${result.plans.reduce((n, p) => n + p.apartments.length, 0)} apartments`);
      }
    }
  }

  /*
   * Hunting for what is still missing. The readers (and, the second time,
   * the extraction) have read what they could; factsAbout says exactly
   * what is known and what is not, and the model picks which links to open
   * to find the rest. Twice at most, eight pages in all.
   */
  const flyers = [];
  const MAX_EXPLORED = 8;
  let explored = 0;
  const exploredLog = [];
  const explore = async (unitsNow, listingNow) => {
    if (explored >= MAX_EXPLORED) return 0;
    const facts = factsAbout({ units: unitsNow, flyers, listing: listingNow, readerNotes: notes });
    if (!facts.missing.length) return 0;
    const visited = new Set(crawl.fetched.map((f) => f.finalUrl));
    const candidates = crawl.links
      .filter((l) => /^https?:/i.test(l.url) && !visited.has(l.url) && !SKIP_LINK_RE.test(l.url))
      .slice(0, 150);
    if (!candidates.length) return 0;
    onStep("Looking for what is still missing");
    const picks = await choosePagesToExplore({
      target: { name: target.name, address: target.address ?? null },
      known: facts.known,
      missing: facts.missing,
      visited: [...visited],
      links: candidates,
      max: Math.min(4, MAX_EXPLORED - explored),
    });
    modelCost += picks.cost;
    let added = 0;
    for (const p of picks.pages) {
      const before = crawl.fetched.length;
      await crawl.follow(p.url);
      const opened = crawl.fetched.length > before;
      exploredLog.push({ url: p.url, lookingFor: p.lookingFor, opened });
      if (opened) {
        added += 1;
        explored += 1;
      }
    }
    console.log(`[source-import] ${target.name}: explored ${added} page(s) for ${facts.missing.join("; ")}: ${picks.pages.map((x) => x.url).join(", ") || "none chosen"}`);
    return added;
  };
  await explore(readerUnits, null);

  /*
   * "What's included" and fee-guide flyers: pictures, read by the model's
   * eyes. They are where student-housing sites keep utilities, lease lengths
   * and fees, so they are read before the extraction and handed to it.
   */
  const flyerSeen = new Set();
  const readFlyers = async () => {
    for (const f of crawl.fetched) {
      for (const url of findFlyerCandidates(crawl.structureOf(f), f.finalUrl)) {
        if (flyerSeen.has(url) || flyers.length >= 2) continue;
        flyerSeen.add(url);
        onStep("Reading the fee guide");
        const flyer = await readInclusionsFlyer(url);
        if (flyer) flyers.push(flyer);
      }
    }
  };
  await readFlyers();
  const flyerSections = () => flyers.map((f) => `FLYER "what is included" (${f.url}):\n${f.text}`);

  // ---- the model: property fields, photos, and units only if nothing read them
  onStep("Filling in the details");
  let images = crawl.images();
  // A Zillow page's own gallery, not the neighbours shown around it.
  let zillowGallery = [];
  let zillowHost = false;
  try {
    zillowHost = ZILLOW_HOST_RE.test(new URL(main.finalUrl).hostname);
  } catch {
    zillowHost = false;
  }
  if (zillowHost) {
    const raw = await renderPage(main.finalUrl, { waitMs: 2000, raw: true });
    const gallery = parseZillowGallery(raw?.html);
    zillowGallery = gallery;
    if (gallery.length) {
      images = gallery.map((url, i) => ({ url, alt: `Photo ${i + 1} of this listing`, pages: [1] }));
      for (const im of images) crawl.imageMap.set(im.url, { alt: im.alt, pages: new Set([1]) });
      console.log(`[source-import] zillow gallery: ${gallery.length} photos of this listing`);
    }
  }
  const diagrams = new Set(readerUnits.map((u) => u.floorPlanImageUrl).filter(Boolean));
  let listing = _modelDraft;
  let modelUsed = null;
  let units = [];
  let runNotes = [];
  let modelUnitCount = 0;
  const extractAndFill = async (force = false) => {
    runNotes = [];
    if (force || !listing || (!readerUnits.length && !listing.units?.length)) {
      const read = await readWithModel({
        pages: crawl.pages,
        images: images.filter((im) => !diagrams.has(im.url)),
        links: isListingPortal(main.finalUrl) ? [] : crawl.links,
        targetProperty: { name: target.name, address: target.address ?? null },
        brandName,
        knownUnits: readerUnits,
        extras: flyerSections(),
      });
      listing = read.draft?.listing ?? null;
      modelUsed = read.model;
      modelCost += read.cost ?? 0;
      if (read.escalated) runNotes.push("Parts of this site were hard to read, so a stronger model was used. Check the units carefully.");
    }

    const modelUnits = unitsFromModel(listing);
    modelUnitCount = modelUnits.length;
    if (readerUnits.length) {
      units = await fillFromModel(readerUnits, modelUnits);
    } else {
      units = await dedupeLayouts(modelUnits);
      if (units.some((u) => u.rentUnknown)) {
        runNotes.push("The site does not say whether its prices are per person or for the whole unit. They were imported as whole-unit rents; switch any that are per person.");
      }
      if (units.length) confidence = listing?.confidence >= 0.75 ? "high" : "low";
    }

    // What the flyers said: lease lengths onto every offer still without them.
    const flyerTerms = [...new Set(flyers.flatMap((f) => f.leaseTermMonths))].filter((n) => Number.isInteger(n) && n >= 1 && n <= 36).sort((a, b) => a - b);
    if (flyerTerms.length) {
      let applied = 0;
      for (const u of units) for (const o of u.offers) if (!(o.leaseTermMonths ?? []).length) { o.leaseTermMonths = flyerTerms; applied += 1; }
      if (applied) {
        runNotes.push(`Lease lengths (${flyerTerms.join(", ")} months) come from the site's fee guide. Check them against each floor plan.`);
      }
    }
    // Lease lengths stated anywhere on the site ("12-month leases" in an FAQ)
    // go on every offer that has none; a building's terms are the building's.
    if (units.length && units.every((u) => u.offers.every((o) => !(o.leaseTermMonths ?? []).length))) {
      const siteTerms = findLeaseTerms(crawl.pages.map((p) => p.text).join("\n"));
      if (siteTerms.length && siteTerms.length <= 6) {
        for (const u of units) for (const o of u.offers) o.leaseTermMonths = siteTerms;
        runNotes.push(`Lease lengths (${siteTerms.join(", ")} months) were read from the site's general text, not from each floor plan. Check them.`);
      }
    }
    // Lease lengths nobody published: say so once rather than leave blanks.
    if (units.length && units.every((u) => u.offers.every((o) => !(o.leaseTermMonths ?? []).length))) {
      runNotes.push("This site doesn't publish its lease lengths. Choose them for each lease before publishing.");
    }
    const waitlisted = units.filter((u) => u.available === false).length;
    if (waitlisted) {
      runNotes.push(`${waitlisted} floor plan${waitlisted === 1 ? " is" : "s are"} waitlist-only on the site, with no price, so ${waitlisted === 1 ? "it is" : "they are"} switched off rather than published as available.`);
    }
  };
  await extractAndFill();
  // Still missing something after the extraction: one more hunt, and if it
  // opened anything, read again with those pages in hand.
  if (await explore(units, listing)) {
    await readFlyers();
    await extractAndFill(true);
  }
  notes.push(...runNotes);

  // ---- photos: the building's, then each unit's own
  const offered = new Set(images.map((im) => im.url));
  const propertyPhotos = (listing?.imageUrls ?? []).filter((u) => offered.has(u) && !diagrams.has(u)).map((u) => ({ url: u, alt: crawl.imageMap.get(u)?.alt ?? "" }));
  for (const u of units) {
    if (u.floorPlanImageUrl && !offered.has(u.floorPlanImageUrl) && !/^https?:/.test(u.floorPlanImageUrl)) u.floorPlanImageUrl = null;
  }
  // A reader that already filed photos per unit (the embedded feed) is not
  // second-guessed; the model sorts only for units that arrived without any.
  const unsorted = units.filter((u) => !(u.photos ?? []).length);
  if (unsorted.length && images.length) {
    onStep("Sorting photos by unit");
    const sorted = await sortPhotosByUnit({ units: unsorted, images: images.filter((im) => !diagrams.has(im.url)) });
    if (sorted) {
      unsorted.forEach((u, i) => {
        u.photos = (sorted.byUnit[i] ?? []).slice(0, 8);
      });
      const onUnits = new Set(sorted.byUnit.flat());
      const shared = sorted.shared.filter((url) => !propertyPhotos.some((p) => p.url === url)).map((url) => ({ url, alt: crawl.imageMap.get(url)?.alt ?? "" }));
      propertyPhotos.splice(0, propertyPhotos.length, ...propertyPhotos.filter((p) => !onUnits.has(p.url)), ...shared);
    }
  }
  // The pictures decide which image is each unit's diagram; filenames only
  // nominated candidates.
  const floorPlanCheck = await confirmFloorPlans(units, { onStep });
  modelCost += floorPlanCheck.costUsd;
  // Every photo in a Zillow listing's gallery is of this listing: all of
  // them are the property's, in the site's order, less any diagram.
  if (zillowGallery.length) {
    const plans = new Set(units.map((u) => u.floorPlanImageUrl).filter(Boolean));
    propertyPhotos.splice(0, propertyPhotos.length, ...zillowGallery.filter((u) => !plans.has(u)).map((url, i) => ({ url, alt: `Photo ${i + 1} of this listing` })));
  }

  // The description must pass the same rules the editor applies on save:
  // no phone numbers, emails, links, handles or people's names.
  const cleaned = sanitizeDescription(listing?.description ?? null);
  if (cleaned.removed.length) {
    console.log(`[source-import] ${target.name}: description scrubbed (${cleaned.removed.map((r) => r.split(":")[0]).join(", ")})`);
    if (listing) listing.description = cleaned.text;
  }

  const sourceUrl = propPage?.finalUrl ?? main.finalUrl;
  const trace = {
    pages: crawl.fetched.map((f) => ({ url: f.finalUrl, chars: htmlToText(f.html).length })),
    reader: platform,
    readerUnits: readerUnits.length,
    model: modelUsed ?? (listing ? "picker" : null),
    modelUnits: modelUnitCount,
    // What this read spent: model dollars (extraction only; the photo sort
    // and flyer reads are logged separately) and paid render calls.
    modelCostUsd: Math.round(modelCost * 1000) / 1000,
    renders: { firecrawl: 0, jina: 0, tavily: 0, ...(readCounters.getStore()?.render ?? {}) },
    // The pages the model chose to open, and what it hoped to find there.
    explored: exploredLog,
    // Pages reused from another building of the batch, and fetched fresh.
    sharedCache: { hits: 0, misses: 0, ...(readCounters.getStore()?.cache ?? {}) },
    found: {
      amenities: (listing?.amenities ?? []).length,
      customAmenities: (listing?.customAmenities ?? []).length,
      utilities: (listing?.utilities_included ?? []).length + flyers.reduce((n, f) => n + f.utilities.length, 0),
      flyers: flyers.map((f) => f.url),
      leaseTerms: units.filter((u) => u.offers.some((o) => (o.leaseTermMonths ?? []).length)).length,
      availabilityDates: units.filter((u) => u.offers.some((o) => o.availableFrom)).length,
      floorPlans: units.filter((u) => u.floorPlanImageUrl).length,
      floorPlanCheck: { checked: floorPlanCheck.checked, changed: floorPlanCheck.changed, cleared: floorPlanCheck.cleared, unsure: floorPlanCheck.unsure },
      propertyPhotos: propertyPhotos.length,
      unitPhotos: units.reduce((n, u) => n + (u.photos ?? []).length, 0),
      concessions: (listing?.concessions ?? []).length + embeddedConcessions.length + g5Concessions.length,
    },
    scrubbed: cleaned.removed,
  };
  /*
   * The notes, checked by the model against what the read finally found:
   * a reader's "this site does not publish lease lengths" is dropped once a
   * leasing portal priced every lease, repeats are merged.
   */
  const finalFacts = factsAbout({ units, flyers, listing });
  const reviewed = await reviewNotes({
    notes: [...notes, ...(listing?.sourceNotes ?? []).slice(0, 3)],
    facts: [
      ...finalFacts.known,
      ...finalFacts.missing.map((m) => `not found: ${m}`),
      learned ? "every apartment's rent and lease lengths came from the building's own leasing portal" : null,
      platform && platform !== "generic" ? `floor plans read from the site's own ${platform} data` : null,
    ].filter(Boolean),
  });
  modelCost += reviewed.cost + (crawl.fileCost ?? 0);
  trace.modelCostUsd = Math.round(modelCost * 1000) / 1000;
  const reviewedNotes = reviewed.notes;
  console.log(`[source-import] ${target.name}: trace ${JSON.stringify(trace)}`);
  const snapshot = makeSnapshot({
    sourceUrl,
    indexUrl: sourceUrl === pastedUrl ? null : pastedUrl,
    platform,
    confidence,
    property: {
      name: listing?.title ?? target.name ?? null,
      address: listing?.address ?? target.address ?? null,
      description: listing?.description ?? null,
      homeType: listing?.home_type ?? null,
      furnished: listing?.furnished ?? null,
      amenities: [...(listing?.amenities ?? []), ...flyers.flatMap((f) => f.amenities)],
      customAmenities: [...(listing?.customAmenities ?? []), ...flyers.flatMap((f) => f.customAmenities)],
      utilities: [...(listing?.utilities_included ?? []), ...flyers.flatMap((f) => f.utilities)],
      contactName: listing?.contact_name ?? null,
      contactEmail: listing?.contact_email ?? null,
      contactPhone: listing?.contact_phone ?? null,
      photos: propertyPhotos,
      concessions: [...(listing?.concessions ?? []), ...embeddedConcessions, ...g5Concessions],
    },
    units,
    notes: reviewedNotes,
  });
  snapshot.model = modelUsed;
  snapshot.trace = trace;
  // Where the numbers live, for the sync to go straight there next time.
  snapshot.portal = learned;
  return snapshot;
}

export { unitKey, isoDate, money };
