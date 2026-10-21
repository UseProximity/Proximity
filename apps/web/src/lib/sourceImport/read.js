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
} from "@/lib/listingDraft/fetchSite";
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
import { EMBEDDED_HINT_RE, parseEmbeddedFloorPlans } from "./readers/rentcafeEmbedded.js";
import { G5_HINT_RE, findG5Urns, fetchG5Locations, fetchG5Inventory } from "./readers/g5.js";
import { parseEmbeddedProperties } from "./readers/embeddedProperties.js";
import { readWithModel, sortPhotosByUnit } from "./model.js";
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
    try {
      const sub = await fetchPageSmart(url);
      if (this.has(sub.finalUrl)) return sub;
      return this.add(sub);
    } catch {
      return null;
    }
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
function fillFromModel(readerUnits, modelUnits) {
  const norm = (s) => String(s ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
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
  return readerUnits;
}

// ---------------------------------------------------------------- discovery

/*
 * What the pasted URL is. Returns one of:
 *   { kind: "pms", pms }
 *   { kind: "error", code, status, message }
 *   { kind: "properties", sourceUrl, properties: [{ name, address, url, kind }] }
 *   { kind: "property", sourceUrl, snapshot, properties }
 */
export async function discoverSite({ url: rawUrl, skipPmsSteer = false, readSingle = false, onStep = () => {} }) {
  const pastedUrl = withScheme(rawUrl.trim());
  const pastedPortal = detectPmsPortal(pastedUrl);
  if (!skipPmsSteer && pastedPortal && SYNCABLE_PMS.has(pastedPortal)) {
    return { kind: "pms", pms: pastedPortal };
  }

  onStep("Reading your website");
  const crawl = new Crawl();
  let main;
  try {
    main = await fetchPageSmart(pastedUrl);
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
export async function readProperty({ pastedUrl: rawPasted, target, onStep = () => {}, _crawl = null, _brandName = null, _modelDraft = null }) {
  const pastedUrl = withScheme(String(rawPasted ?? target.levelUrl ?? target.url).trim());
  const startUrl = withScheme(String(target.levelUrl ?? pastedUrl).trim());
  const notes = [];
  const crawl = _crawl ?? new Crawl();
  let main = crawl.fetched[0] ?? null;

  if (!main) {
    onStep("Reading your website");
    main = await fetchPageSmart(startUrl); // throws DraftFetchError
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
    /*
     * The pages a building's facts are spread over: amenities and features
     * (utilities, furnishing), FAQ and fees (lease lengths, what is
     * included), gallery (photos), specials. Same-site, cached, cheap; six
     * at most, in that order of usefulness.
     */
    const DEEP_RE = /amenit|feature|faq|fees?\b|pricing|utilit|includ|lease|special|gallery|photo|tour|availab|neighborhood|location/i;
    const deeper = extractLinks(crawl.structureOf(propPage), propPage.finalUrl, 80)
      .filter((l) => DEEP_RE.test(`${l.url} ${l.text}`) && l.url !== propPage.finalUrl && !/resident|portal|login|apply|pay|blog|feed|wp-json|popup=|\?tour/i.test(l.url))
      .sort((a, b) => DEEP_RE.exec(`${a.url} ${a.text}`).index - DEEP_RE.exec(`${b.url} ${b.text}`).index)
      .slice(0, 6);
    if (deeper.length) onStep("Reading amenities and details");
    for (const l of deeper) await crawl.follow(l.url);
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
      const inv = await fetchG5Inventory(location);
      if (!inv) continue;
      {
        platform = "g5";
        readerUnits = inv.units;
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
        readerUnits = unitsFromSightmap(inv);
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
      readerUnits = parsed.units;
      embeddedConcessions = parsed.concessions;
      notes.push(...parsed.notes);
      confidence = "high";
      console.log(`[source-import] embedded floor plans on ${f.finalUrl}: ${parsed.units.length} plans`);
      break;
    }
  }

  // 3. Entrata floor plan cards.
  if (!readerUnits.length) {
    const page = crawl.fetched.find((f) => ENTRATA_HINT_RE.test(f.html) && parseEntrataFloorPlans(f.html, f.finalUrl));
    const parsed = page ? parseEntrataFloorPlans(page.html, page.finalUrl) : null;
    if (parsed) {
      platform = "entrata";
      readerUnits = parsed.units;
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
        readerUnits = unitsFromFloorPlans(result);
        confidence = "high";
        if (result.termRange?.min) {
          notes.push(`This building quotes lease terms from ${result.termRange.min} to ${result.termRange.max} months and publishes one rate per apartment. Check the term before you publish.`);
        }
        console.log(`[source-import] floor plans: ${result.plans.length} plans, ${result.plans.reduce((n, p) => n + p.apartments.length, 0)} apartments`);
      }
    }
  }

  /*
   * "What's included" and fee-guide flyers: pictures, read by the model's
   * eyes. They are where student-housing sites keep utilities, lease lengths
   * and fees, so they are read before the extraction and handed to it.
   */
  const flyers = [];
  {
    const seen = new Set();
    for (const f of crawl.fetched) {
      for (const url of findFlyerCandidates(crawl.structureOf(f), f.finalUrl)) {
        if (seen.has(url) || flyers.length >= 2) continue;
        seen.add(url);
        onStep("Reading the fee guide");
        const flyer = await readInclusionsFlyer(url);
        if (flyer) flyers.push(flyer);
      }
    }
  }
  const flyerSections = flyers.map((f) => `FLYER "what is included" (${f.url}):\n${f.text}`);

  // ---- the model: property fields, photos, and units only if nothing read them
  onStep("Filling in the details");
  const images = crawl.images();
  const diagrams = new Set(readerUnits.map((u) => u.floorPlanImageUrl).filter(Boolean));
  let listing = _modelDraft;
  let modelUsed = null;
  if (!listing || (!readerUnits.length && !listing.units?.length)) {
    const read = await readWithModel({
      pages: crawl.pages,
      images: images.filter((im) => !diagrams.has(im.url)),
      links: isListingPortal(main.finalUrl) ? [] : crawl.links,
      targetProperty: { name: target.name, address: target.address ?? null },
      brandName,
      knownUnits: readerUnits,
      extras: flyerSections,
    });
    listing = read.draft?.listing ?? null;
    modelUsed = read.model;
    if (read.escalated) notes.push("Parts of this site were hard to read, so a stronger model was used. Check the units carefully.");
  }

  const modelUnits = unitsFromModel(listing);
  let units;
  if (readerUnits.length) {
    units = fillFromModel(readerUnits, modelUnits);
  } else {
    units = modelUnits;
    if (units.some((u) => u.rentUnknown)) {
      notes.push("The site does not say whether its prices are per person or for the whole unit. They were imported as whole-unit rents; switch any that are per person.");
    }
    if (units.length) confidence = listing?.confidence >= 0.75 ? "high" : "low";
  }

  // What the flyers said: lease lengths onto every offer still without them.
  const flyerTerms = [...new Set(flyers.flatMap((f) => f.leaseTermMonths))].filter((n) => Number.isInteger(n) && n >= 1 && n <= 36).sort((a, b) => a - b);
  if (flyerTerms.length) {
    let applied = 0;
    for (const u of units) for (const o of u.offers) if (!(o.leaseTermMonths ?? []).length) { o.leaseTermMonths = flyerTerms; applied += 1; }
    if (applied) {
      for (let i = notes.length - 1; i >= 0; i--) if (/lease lengths/i.test(notes[i])) notes.splice(i, 1);
      notes.push(`Lease lengths (${flyerTerms.join(", ")} months) come from the site's fee guide. Check them against each floor plan.`);
    }
  }
  // Lease lengths stated anywhere on the site ("12-month leases" in an FAQ)
  // go on every offer that has none; a building's terms are the building's.
  if (units.length && units.every((u) => u.offers.every((o) => !(o.leaseTermMonths ?? []).length))) {
    const siteTerms = findLeaseTerms(crawl.pages.map((p) => p.text).join("\n"));
    if (siteTerms.length && siteTerms.length <= 6) {
      for (const u of units) for (const o of u.offers) o.leaseTermMonths = siteTerms;
      notes.push(`Lease lengths (${siteTerms.join(", ")} months) were read from the site's general text, not from each floor plan. Check them.`);
    }
  }
  // Lease lengths nobody published: say so once rather than leave blanks.
  if (units.length && !notes.some((n) => /lease lengths/i.test(n)) && units.every((u) => u.offers.every((o) => !(o.leaseTermMonths ?? []).length))) {
    notes.push("This site doesn't publish its lease lengths. Choose them for each lease before publishing.");
  }
  const waitlisted = units.filter((u) => u.available === false).length;
  if (waitlisted) {
    notes.push(`${waitlisted} floor plan${waitlisted === 1 ? " is" : "s are"} waitlist-only on the site, with no price, so ${waitlisted === 1 ? "it is" : "they are"} switched off rather than published as available.`);
  }

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

  const sourceUrl = propPage?.finalUrl ?? main.finalUrl;
  const trace = {
    pages: crawl.fetched.map((f) => ({ url: f.finalUrl, chars: htmlToText(f.html).length })),
    reader: platform,
    readerUnits: readerUnits.length,
    model: modelUsed ?? (listing ? "picker" : null),
    modelUnits: modelUnits.length,
    found: {
      amenities: (listing?.amenities ?? []).length,
      customAmenities: (listing?.customAmenities ?? []).length,
      utilities: (listing?.utilities_included ?? []).length + flyers.reduce((n, f) => n + f.utilities.length, 0),
      flyers: flyers.map((f) => f.url),
      leaseTerms: units.filter((u) => u.offers.some((o) => (o.leaseTermMonths ?? []).length)).length,
      availabilityDates: units.filter((u) => u.offers.some((o) => o.availableFrom)).length,
      floorPlans: units.filter((u) => u.floorPlanImageUrl).length,
      propertyPhotos: propertyPhotos.length,
      unitPhotos: units.reduce((n, u) => n + (u.photos ?? []).length, 0),
      concessions: (listing?.concessions ?? []).length + embeddedConcessions.length + g5Concessions.length,
    },
  };
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
    notes: [...notes, ...(listing?.sourceNotes ?? []).filter((n) => !/supplied separately|unit list|instruction|known units/i.test(n)).slice(0, 3)],
  });
  snapshot.model = modelUsed;
  snapshot.trace = trace;
  return snapshot;
}

export { unitKey, isoDate, money };
