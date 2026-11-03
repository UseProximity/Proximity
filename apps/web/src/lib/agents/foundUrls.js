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
