/*
 * What kind of source a found URL is (lib/agents/discover.js): Zillow,
 * Apartments.com, or a property's or company's own site, and whether it is a
 * building's page, one apartment's or a site's front page. Other portals and
 * search or city pages are not kept (Wyatt, 2026-10-31: own sites, Zillow and
 * Apartments.com only).
 *
 * Pure on purpose. foundUrls.test.js covers it.
 */

// Portals and directories that are not one of the three kinds we keep.
const OTHER_PORTALS = [
  "realtor.com", "trulia.com", "hotpads.com", "movoto.com", "homes.com", "forrent.com", "rentseeker.com",
  "redfin.com", "zumper.com", "rent.com", "apartmentlist.com", "apartmentguide.com", "apartmentfinder.com",
  "padmapper.com", "craigslist.org", "facebook.com", "instagram.com", "linkedin.com", "yelp.com", "google.com",
  "nextdoor.com", "yellowpages.com", "bbb.org", "mapquest.com", "loopnet.com", "compass.com", "rentcafe.com",
  "rentals.com", "apartmenthomeliving.com", "rentable.co", "renthop.com", "cozy.co", "avail.co", "offcampushousing.com",
  "places4students.com", "uloop.com", "wikipedia.org", "youtube.com", "tiktok.com", "x.com", "twitter.com",
  "streeteasy.com", "point2homes.com", "propertyshark.com", "niche.com", "walkscore.com", "rentometer.com",
  "zillowstatic.com", "remax.com", "coldwellbankerhomes.com", "kw.com", "century21.com", "har.com", "homesnap.com",
  "estately.com", "rehold.com", "blockshopper.com", "spokeo.com", "whitepages.com", "fastpeoplesearch.com",
  "corporatehousing.com", "furnishedfinder.com", "blueground.com", "airbnb.com", "vrbo.com", "landing.com",
  "rentberry.com", "housingsearch.wustl.edu", "wustl.edu", "washu.edu", "slu.edu", "umsl.edu", "showmojo.com",
  "zillow.net", "trulia.net", "apartments.net", "apartmentratings.com", "glassdoor.com", "indeed.com",
  // Our own site: its listing and guide pages copy the address, but are never a source.
  "useproximity.org", "proximity-livid.vercel.app", "proximity-sandbox.vercel.app",
];

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}
export const onDomain = (host, domain) => host === domain || host?.endsWith(`.${domain}`);

/*
 * "2528-Texas-Ave-506-Saint-Louis-MO-63104" is one apartment (a unit after the
 * street); "7342-Dartmouth-Ave-Saint-Louis-MO-63130" is the whole place.
 */
const STREET_SUFFIX = /^(ave|av|blvd|st|dr|pl|rd|ct|ln|pkwy|ter|way|cir|sq|hwy)$/i;
const CITY_START = /^(saint|st|university|clayton|maplewood|richmond|webster|brentwood|ladue|kirkwood|olivette|creve|town|des|ballwin|chesterfield|florissant|ferguson|mo)$/i;
export function zillowSlugIsUnit(slug) {
  const t = String(slug).split("-");
  const i = t.findIndex((w, k) => k > 1 && STREET_SUFFIX.test(w));
  if (i < 0 || i + 1 >= t.length) return false;
  return !CITY_START.test(t[i + 1]);
}

/*
 * Which kind of source a URL is, and whether it is a page about one place at
 * all: Zillow's search and city pages and Apartments.com's city pages are
 * neither a building nor an apartment, so they are not kept.
 */
export function classifyUrl(url) {
  const host = hostOf(url);
  if (!host) return null;
  let path = "";
  try { path = new URL(url).pathname; } catch { return null; }
  if (onDomain(host, "zillow.com")) {
    if (/^\/homedetails\//.test(path)) {
      return { site: "zillow", pageType: zillowSlugIsUnit(path.split("/")[2] ?? "") ? "unit" : "building" };
    }
    if (/^\/(b|apartments)\//.test(path)) return { site: "zillow", pageType: "building" };
    return null;
  }
  if (onDomain(host, "apartments.com")) {
    // Property pages end in a short id: /central-park-saint-louis-mo/skzqrn4/
    const parts = path.split("/").filter(Boolean);
    // ...and that id mixes letters and digits; "/shaw-saint-louis-mo/studios" is a neighbourhood page.
    if (parts.length !== 2 || !/^(?=.*\d)(?=.*[a-z])[a-z0-9]{5,9}$/.test(parts[1])) return null;
    return { site: "apartments_com", pageType: /-unit-/.test(parts[0]) ? "unit" : "building" };
  }
  if (OTHER_PORTALS.some((d) => onDomain(host, d))) return null;
  return { site: "own_site", pageType: path.replace(/\/+$/, "") === "" ? "home" : "building" };
}

/*
 * Found pages and the landlord's own pages (lib/agents/foundRead.js).
 *
 * Source search lists the pages a listing already has next to the ones it
 * finds, and found_by says how it came to each one. "imported from" and
 * "agent reads it" mean the landlord gave us the page before any search: it
 * stays the landlord's (read by the daily sync, rank 1), and the found reader
 * leaves it alone.
 *
 * The found reader is the only code that creates a page source with a
 * FOUND_CHECK_INTERVAL_DAYS interval, and a source's interval is never changed
 * after it is created. So a page source counts as found only when the found
 * reader created it AND its found row is not one the landlord gave. A
 * landlord page that search also turned up keeps its landlord rank and its
 * place in the daily sync, whatever the found row's status.
 */
export const SITE_RANK = { own_site: 2, company_site: 2, apartments_com: 3, zillow: 4 };
export const LANDLORD_PAGE_RANK = 1;
export const TOP_RANK = 0;
export const FOUND_CHECK_INTERVAL_DAYS = 30;
// Pages read per listing, the most likely first.
export const MAX_FOUND_PAGES = 8;

const LANDLORD_FOUND_BY = ["imported from", "agent reads it"];
const PAGE_ORDER = { building: 0, unit: 1, home: 2 };

export function landlordGave(foundBy) {
  return String(foundBy ?? "").split(";").map((s) => s.trim()).some((s) => LANDLORD_FOUND_BY.includes(s));
}

/* A page source the found reader made for a page the landlord did not give. */
export function isFoundSource(source, foundRow) {
  return Boolean(foundRow) && !landlordGave(foundRow.found_by) && source?.check_interval_days === FOUND_CHECK_INTERVAL_DAYS;
}

/* The rank of one source. `foundRow` is the listing's found row for its url, any status. */
export function sourceRank(source, foundRow) {
  if (source.kind !== "page") return TOP_RANK;
  if (isFoundSource(source, foundRow) && SITE_RANK[foundRow.site]) return SITE_RANK[foundRow.site];
  return LANDLORD_PAGE_RANK;
}

/*
 * The found pages the reader reads for one listing: confirmed, on a site we
 * rank, not given by the landlord, and not already a landlord page source
 * (`sourceByUrl`: the listing's page sources by url). Best first, at most
 * MAX_FOUND_PAGES.
 */
export function pagesToRead(foundRows, sourceByUrl = new Map()) {
  return foundRows
    .filter((r) => r.status === "confirmed" && SITE_RANK[r.site] && !landlordGave(r.found_by))
    .filter((r) => { const s = sourceByUrl.get(r.url); return !s || isFoundSource(s, r); })
    .sort((a, b) => SITE_RANK[a.site] - SITE_RANK[b.site]
      || (PAGE_ORDER[a.page_type] ?? 9) - (PAGE_ORDER[b.page_type] ?? 9)
      || Number(b.confidence ?? 0) - Number(a.confidence ?? 0))
    .slice(0, MAX_FOUND_PAGES);
}

/* Whether the reader has looked at a page (since `since`, when given). A failed read counts. */
export function pageLooked(source, since = null) {
  if (!source?.last_checked_at) return false;
  return !since || new Date(source.last_checked_at) >= new Date(since);
}
