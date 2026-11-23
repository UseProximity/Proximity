/*
 * Finding every page of a listing's website (Wyatt, 2026-10-27, round 6:
 * "scrape literally everything"; Jasper's /amenities and /faqs were missed).
 *
 * Breadth-first from the listing's source URL, same site only, up to a cap
 * (50 pages). Pages most likely to hold renter facts go first (amenities,
 * FAQs, fees, pets, parking, policies, neighborhood). Asset files, logins,
 * payments, applications, careers and blog archives are skipped. On a site
 * that lists several properties under paths (keeleyproperties.com/
 * properties/the-clover/...), the crawl stays inside this property's path
 * plus a few site-wide pages (FAQ, policies, contact).
 *
 * Returns [{ url, html }] for the pages it could read.
 */
import { fetchPageSmart } from "@/lib/listingDraft/fetchSite";

export const MAX_CRAWL_PAGES = 50;
const CONCURRENCY = 5;

const SKIP = /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|xml|zip|mp4|mov|mp3|docx?|xlsx?)(\?|$)|\/(wp-admin|wp-json|login|log-in|signin|sign-in|account|portal|resident-login|pay|payments|apply|application|careers|jobs|cart|checkout|feed|tag|author|category|page\/\d+)(\/|$)|mailto:|tel:|javascript:/i;
const PRIORITY = /(amenit|faq|question|fee|pricing|price|pet|parking|garage|polic|rule|utilit|neighbo|location|area|features|floor|plan|availab|special|offer|concession|contact|about|gallery|tour|lease|move|package|accessib)/i;
const SITE_WIDE = /(faq|question|polic|rule|fee|pet|parking|contact|about|amenit)/i;

/*
 * A translated copy of a page (/es-cl/about, /it/about, ?lang=fr): the same
 * facts as the English page in other words, so reading it only rewrites
 * them (Grove Lofts, 2026-11-23: one office-hours fact written three times
 * in one run, and a student told twice). English copies (/en/, /en-us/,
 * ?locale=en_US) are kept. The listing's own start URL is never skipped.
 *
 * Two lists of language codes. A path starting with a CLEAR code is a
 * translation on its own. A path starting with one of the OTHER codes is
 * one only when the read already has the same page without it (/pa/missouri
 * beside /missouri), because those codes double as ordinary path words or
 * place names elsewhere (hi, he, id too: /hi/about is Hindi only beside
 * /about). Codes that are everyday English paths (faq, map, gym, cs, no,
 * my, us, uk, la, co...) are on neither list (PR 475 review: /faq was being
 * dropped as a "copy" of the home page).
 */
const CLEAR = "es|fr|de|it|pt|zh|ja|ko|ru|ar|nl|pl|tr|vi|sv|da|fi|el|ro|hu|fa|ur|bn";
const OTHER = "hi|he|id|sl|sk|hr|sr|bg|lt|lv|et|ka|hy|az|kk|uz|mn|ne|si|ta|te|kn|ml|gu|pa|sw|zu|xh|af|sq|mk|bs|cy|ga|gd|eu|gl|km|th|ht|ig|yo|ps|ku|ky|tg|tk|lb|fy|eo|mg|nb|nn|tl|ceb|hmn|haw|iw|jw|yi";
const SUFFIX = "(?:[-_](?:[a-z]{2}|hans|hant|latn))?";
const CLEAR_PATH = new RegExp(`^/(?:${CLEAR})${SUFFIX}(?:/|$)`, "i");
const OTHER_PATH = new RegExp(`^/(?:${OTHER})${SUFFIX}(/.+)$`, "i");
const ENGLISH = /^(?:en(?:[-_][a-z]{2,4})?|english)$/i;

export function isTranslatedCopy(url) {
  try {
    const u = new URL(url);
    if (CLEAR_PATH.test(u.pathname)) return true;
    for (const k of ["lang", "hl", "locale", "language"]) {
      const v = u.searchParams.get(k);
      if (v && !ENGLISH.test(v.trim())) return true;
    }
    return false;
  } catch { return false; }
}

/*
 * For a path starting with one of the OTHER codes, the same page without it
 * (/pa/missouri gives /missouri). Never the site's home page: a bare /pa is
 * not called a copy of anything.
 */
export function localeTwin(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(OTHER_PATH);
    if (!m) return null;
    u.pathname = m[1];
    return u.toString().replace(/\/$/, "");
  } catch { return null; }
}
const twinKey = (u) => String(u ?? "").replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();
export function isLanguageCopy(url, haveUrl) {
  if (isTranslatedCopy(url)) return true;
  const twin = localeTwin(url);
  return !!twin && haveUrl(twinKey(twin));
}
export { twinKey };

/*
 * The English page a language copy stands for: the path without its
 * language part, and without a language query. Used to give facts filed
 * under a skipped copy the same read status as that page (pages.js).
 */
export function languageTwinUrl(url) {
  try {
    const u = new URL(url);
    for (const k of ["lang", "hl", "locale", "language"]) u.searchParams.delete(k);
    const m = u.pathname.match(new RegExp(`^/(?:${CLEAR}|${OTHER})${SUFFIX}(/.*)?$`, "i"));
    if (m) u.pathname = m[1] || "/";
    return u.toString().replace(/\/$/, "");
  } catch { return null; }
}

function normalize(raw, base) {
  try {
    const u = new URL(raw, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function linksIn(html, base) {
  const out = [];
  const re = /href\s*=\s*["']([^"'#][^"']*)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = normalize(m[1], base);
    if (u) out.push(u);
  }
  return out;
}

const host = (u) => new URL(u).hostname.replace(/^www\./, "");

/*
 * The part of the path that is this property's on a multi-property site:
 * /properties/the-clover-at-olive-crossing from .../properties/the-clover-at-olive-crossing/.
 * Null when the listing has its own site (the path is just "/" or a page name).
 */
function propertyPrefix(startUrl) {
  const parts = new URL(startUrl).pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && /^(properties|property|communities|community|apartments|buildings|locations)$/i.test(parts[0])) return `/${parts[0]}/${parts[1]}`;
  return null;
}

// allowUrl: when set, pages outside it are never opened (the sites a
// landlord gave us, lib/sourceSync/givenSites.js).
export async function crawlSite(startUrl, { max = MAX_CRAWL_PAGES, onPage = () => {}, allowUrl = null } = {}) {
  const start = normalize(startUrl, startUrl);
  if (!start) return [];
  const site = host(start);
  const prefix = propertyPrefix(start);
  const inScope = (u) => {
    try {
      if (host(u) !== site || SKIP.test(u) || isTranslatedCopy(u)) return false;
      if (allowUrl && !allowUrl(u)) return false;
      if (!prefix) return true;
      const path = new URL(u).pathname;
      return path.startsWith(prefix) || (SITE_WIDE.test(path) && !/^\/(properties|property|communities|community|apartments|buildings|locations)\//i.test(path));
    } catch { return false; }
  };

  const seen = new Set([start]);
  const seenKeys = new Set([twinKey(start)]);
  const queue = [start];
  const pages = [];
  while (queue.length && pages.length < max) {
    // Informative-looking paths first, then shallow before deep.
    queue.sort((a, b) => (PRIORITY.test(b) - PRIORITY.test(a)) || (a.split("/").length - b.split("/").length));
    const batch = queue.splice(0, Math.min(CONCURRENCY, max - pages.length));
    const read = await Promise.all(batch.map(async (url) => {
      try {
        const page = await fetchPageSmart(url);
        return page?.html ? { url, html: page.html } : null;
      } catch {
        return null;
      }
    }));
    for (const p of read) {
      if (!p) continue;
      pages.push(p);
      onPage(pages.length, p.url);
      for (const link of linksIn(p.html, p.url)) {
        if (seen.has(link) || !inScope(link)) continue;
        if (isLanguageCopy(link, (k) => seenKeys.has(k))) continue;
        seen.add(link);
        seenKeys.add(twinKey(link));
        queue.push(link);
      }
    }
  }
  return pages;
}
