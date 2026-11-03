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

export async function crawlSite(startUrl, { max = MAX_CRAWL_PAGES, onPage = () => {} } = {}) {
  const start = normalize(startUrl, startUrl);
  if (!start) return [];
  const site = host(start);
  const prefix = propertyPrefix(start);
  const inScope = (u) => {
    try {
      if (host(u) !== site || SKIP.test(u)) return false;
      if (!prefix) return true;
      const path = new URL(u).pathname;
      return path.startsWith(prefix) || (SITE_WIDE.test(path) && !/^\/(properties|property|communities|community|apartments|buildings|locations)\//i.test(path));
    } catch { return false; }
  };

  const seen = new Set([start]);
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
        seen.add(link);
        queue.push(link);
      }
    }
  }
  return pages;
}
