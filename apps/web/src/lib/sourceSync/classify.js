/*
 * Classify a source URL's host as the landlord's own site or a third-party portal.
 *
 * This exists so portal monitoring is countable, auditable, and switchable as a group.
 * PMS_COVERAGE_BRIEF.md Appendix B requires that a complaint can be honoured within
 * 24 hours; SOURCE_SYNC_PORTALS_ENABLED plus this classification is that lever, and it
 * works without a deploy and without touching any listing data. Note the switch is an
 * explicit OFF (see sourceKindEnabled below) — classification stays useful for
 * counting and audit even while every portal monitor is running normally.
 */

// Third-party listing sites and aggregators. Matched on the registrable domain, so
// regional and country variants of the same brand are covered.
const PORTAL_DOMAINS = [
  "zillow.com",
  "apartments.com",
  "trulia.com",
  "hotpads.com",
  "realtor.com",
  "rent.com",
  "apartmentfinder.com",
  "apartmentlist.com",
  "forrent.com",
  "padmapper.com",
  "craigslist.org",
  "facebook.com",
  "redfin.com",
  "zumper.com",
  "rentals.com",
  "apartmentguide.com",
  "streeteasy.com",
  "westsiderentals.com",
  "abodo.com",
  "rentcafe.com",
  "securecafe.com",
  "offcampuspartners.com",
  "places4students.com",
  // CoStar's university vertical. forrent.com is already above; this sibling is the
  // same company and was silently classifying as a landlord's own site.
  "forrentuniversity.com",
];

/* Registrable domain, naive last-two-labels (matches sameSite() in fetchSite.js). */
export function registrableDomain(host) {
  const parts = String(host ?? "").toLowerCase().replace(/^www\./, "").split(".");
  return parts.slice(-2).join(".");
}

export function isPortalHost(host) {
  const domain = registrableDomain(host);
  return PORTAL_DOMAINS.includes(domain);
}

/*
 * Returns { url, host, kind } or null when the URL is unusable.
 * kind is "portal" or "own_site" — the values listings.source_kind accepts.
 */
export function classifySourceUrl(rawUrl) {
  let parsed;
  try {
    const withScheme = /^https?:\/\//i.test(String(rawUrl ?? "").trim())
      ? String(rawUrl).trim()
      : `https://${String(rawUrl ?? "").trim()}`;
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname || !parsed.hostname.includes(".")) return null;

  return {
    url: parsed.toString(),
    host: parsed.hostname.replace(/^www\./, ""),
    kind: isPortalHost(parsed.hostname) ? "portal" : "own_site",
  };
}

/*
 * Whether a monitor may run right now.
 *
 * Portals run BY DEFAULT (Ben, 2026-08-24: we have permission from the companies we
 * list, and a monitor must never stop scraping unless he says so for a named site).
 * SOURCE_SYNC_PORTALS_ENABLED=false is therefore an explicit OFF switch rather than
 * an opt-in: it still honours a complaint within the 24 hours Appendix B requires,
 * without a deploy and without touching listing data, but an unset variable can no
 * longer silently disable a whole class of monitors.
 *
 * To stop ONE site rather than the whole group, disable that listing's monitor
 * (listing_source_monitors.enabled = false, or muted_until) from the admin console.
 * That is the per-site lever; this is the group lever.
 */
export function sourceKindEnabled(kind) {
  if (kind !== "portal") return true;
  return String(process.env.SOURCE_SYNC_PORTALS_ENABLED ?? "").toLowerCase() !== "false";
}
