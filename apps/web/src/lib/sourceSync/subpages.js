/*
 * A listing's own page on a company-wide website (Wyatt, 2026-11-07).
 *
 * A landlord sometimes gives us their company's site (macapartments.com) for
 * several listings, or for one building that the site lists among others.
 * The page that speaks for one building is deeper on the same site
 * (macapartments.com/euclid). Before the daily sync, each company-wide page is
 * read with the importer's site reader (discoverSite), and a listing that
 * matches exactly one property there gets that property's page as its source:
 * listings.source_url becomes the property's page and the company page stays
 * on the monitor as index_url, where new and gone units are noticed.
 *
 * Attached automatically (Wyatt's call). It is safe during launch review: a
 * wrongly attached page can change nothing students see, because every change
 * it leads to waits for the team. Every attach is recorded as a
 * source_attached event and listed in the team's daily digest. A listing that
 * matches no property, or more than one, is left alone.
 *
 * Only pages on the same site as the given URL are ever attached.
 */
import supabase from "@/lib/supabase";
import { discoverSite } from "@/lib/sourceImport/read";
import { attachSourceUrl } from "./attach.js";
import { onGivenSite } from "./givenSites.js";
import { isPortalHost } from "./classify.js";

const RECHECK_DAYS = 30;
const MAX_SITES_PER_RUN = 6;

const norm = (u) => String(u ?? "").trim().replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();
const streetNumber = (s) => String(s ?? "").match(/^\s*(\d{1,6})\b/)?.[1] ?? null;
const words = (s) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !["apartments", "apartment", "the", "and", "lofts", "street", "avenue", "boulevard"].includes(w));

function pathDepth(url) {
  try { return new URL(url).pathname.split("/").filter(Boolean).length; } catch { return 99; }
}

/*
 * Pure: the one property on the site that is this listing, or null.
 * The street number has to agree when both have one; otherwise the name has
 * to share at least two words (one when the property's name is one word).
 */
export function matchProperty(listing, properties) {
  const num = streetNumber(listing.address);
  const lw = new Set([...words(listing.title), ...words(listing.address)]);
  const hits = properties.filter((p) => {
    const pn = streetNumber(p.address) ?? streetNumber(p.name);
    if (num && pn) return num === pn && (!lw.size || words(`${p.name} ${p.address}`).some((w) => lw.has(w)));
    const pw = words(p.name);
    const shared = pw.filter((w) => lw.has(w)).length;
    return pw.length && shared >= Math.min(2, pw.length);
  });
  return hits.length === 1 ? hits[0] : null;
}

/* Monitors whose given page looks company-wide and is due for a look. */
async function candidates() {
  const { data, error } = await supabase
    .from("listing_source_monitors")
    .select("id, listing_id, source_url, index_url, subpages_checked_at, enabled, listings!listing_id(id, title, address, published_at, deleted_at, source_added_by)")
    .eq("enabled", true)
    .is("index_url", null)
    .limit(2000);
  if (error) throw new Error(`monitors: ${error.message}`);
  const live = (data ?? []).filter((m) => m.listings && !m.listings.deleted_at && m.listings.published_at);
  const bySite = new Map();
  for (const m of live) {
    let host = null;
    try { host = new URL(m.source_url).hostname; } catch { continue; }
    if (isPortalHost(host)) continue;
    const k = norm(m.source_url);
    if (!bySite.has(k)) bySite.set(k, []);
    bySite.get(k).push(m);
  }
  const cutoff = Date.now() - RECHECK_DAYS * 86400000;
  return [...bySite.values()].filter((group) => {
    // Shared by several listings, or the top of a site: likely company-wide.
    const companyWide = group.length > 1 || pathDepth(group[0].source_url) === 0;
    const due = group.some((m) => !m.subpages_checked_at || new Date(m.subpages_checked_at).getTime() < cutoff);
    return companyWide && due;
  });
}

export async function attachSubpages({ limit = MAX_SITES_PER_RUN, dryRun = false } = {}) {
  const groups = (await candidates()).slice(0, limit);
  const attached = [];
  const unmatched = [];
  for (const group of groups) {
    const given = group[0].source_url;
    let found = null;
    try {
      found = await discoverSite({ url: given, skipPmsSteer: true });
    } catch (err) {
      console.error(`[subpages] ${given}: ${err?.message ?? err}`);
    }
    const properties = found?.kind === "properties"
      ? (found.properties ?? []).filter((p) => p.kind !== "group" && p.url && norm(p.url) !== norm(given) && onGivenSite(p.url, [given]))
      : [];
    const taken = new Set();
    for (const m of group) {
      const l = m.listings;
      const p = properties.length ? matchProperty(l, properties) : null;
      if (!p || taken.has(norm(p.url))) {
        if (properties.length) unmatched.push({ listingId: l.id, listing: l.title || l.address, site: given });
        continue;
      }
      taken.add(norm(p.url));
      attached.push({ listingId: l.id, listing: l.title || l.address, from: given, to: p.url, property: p.name });
      if (dryRun) continue;
      const r = await attachSourceUrl({ listingId: l.id, rawUrl: p.url, indexUrl: given, userId: l.source_added_by ?? null });
      if (!r.ok) {
        console.error(`[subpages] ${l.title || l.address}: attach failed (${r.reason})`);
        continue;
      }
      await supabase.from("listing_source_events").insert({
        monitor_id: m.id, listing_id: l.id, kind: "source_attached", field: "source_url", old_value: given, new_value: p.url,
        confidence: "high", status: "applied", applied: true,
        detail: { op: "none", label: p.name ?? null, from: given, to: p.url, note: "the listing's own page on the website the landlord gave us" },
      });
      console.log(`[subpages] ${l.title || l.address}: ${given} -> ${p.url}`);
    }
    if (!dryRun) {
      await supabase.from("listing_source_monitors").update({ subpages_checked_at: new Date().toISOString() }).in("id", group.map((m) => m.id));
    }
  }
  return { sites: groups.length, attached, unmatched };
}
