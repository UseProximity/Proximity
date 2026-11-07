/*
 * The pages a listing may be synced from (Wyatt, 2026-11-07).
 *
 * Only what a landlord uploaded or gave us counts as a source: the listing's
 * website (listings.source_url and its monitor), the company page it was
 * listed on (index_url) and any unit's own page. A sync may read those pages
 * and other pages on the same sites, including their subdomains
 * (macapartments.com/euclid, euclid.macapartments.com). It reads nothing
 * else: not a building's own site linked from a portal, not a page our
 * source search found, not a link someone typed into a description.
 *
 * A listing portal (Zillow, Apartments.com) is one site for every building
 * on it, so a given portal page only allows pages under its own path.
 */
import supabase from "@/lib/supabase";
import { registrableDomain, isPortalHost } from "./classify.js";

function parse(url) {
  try {
    const u = new URL(String(url).trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    return u;
  } catch {
    return null;
  }
}

const trimPath = (p) => p.replace(/\/+$/, "");

/* Pure: does `url` fall under one of the `given` URLs? */
export function onGivenSite(url, given) {
  const u = parse(url);
  if (!u) return false;
  for (const g of given ?? []) {
    const gu = parse(g);
    if (!gu) continue;
    if (isPortalHost(gu.hostname)) {
      if (u.hostname.replace(/^www\./, "") !== gu.hostname.replace(/^www\./, "")) continue;
      const base = trimPath(gu.pathname);
      const path = trimPath(u.pathname);
      if (path === base || path.startsWith(`${base}/`)) return true;
      continue;
    }
    if (registrableDomain(u.hostname) === registrableDomain(gu.hostname)) return true;
  }
  return false;
}

/* A predicate for one listing's given URLs. */
export function givenSiteFilter(given) {
  const list = [...new Set((given ?? []).filter(Boolean))];
  const allow = (url) => onGivenSite(url, list);
  allow.given = list;
  return allow;
}

/* Every URL a landlord gave us for this listing. */
export async function givenUrlsFor(listingId) {
  const [{ data: listing }, { data: monitor }, { data: unitPages }] = await Promise.all([
    supabase.from("listings").select("source_url").eq("id", listingId).maybeSingle(),
    supabase.from("listing_source_monitors").select("source_url, index_url").eq("listing_id", listingId).maybeSingle(),
    supabase.from("listing_unit_pages").select("url").eq("listing_id", listingId).is("deleted_at", null),
  ]);
  return [listing?.source_url, monitor?.source_url, monitor?.index_url, ...(unitPages ?? []).map((p) => p.url)].filter(Boolean);
}

export async function givenSiteFilterFor(listingId) {
  return givenSiteFilter(await givenUrlsFor(listingId));
}
