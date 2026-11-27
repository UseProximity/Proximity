/*
 * Application links in chat (Wyatt, 2026-11-20).
 *
 * A landlord's application belongs on the listing (unit_leases.application_url,
 * set in the dashboard's contact block), where the Apply button opens it and
 * the click is tracked. Sent in chat, it skips both. So a landlord's chat
 * message carrying an application link is refused outright, with no "send
 * anyway", and the landlord is pointed at the dashboard field instead. By email
 * the link is cut out and the landlord is emailed the same advice.
 *
 * Any other outside link keeps the usual "send anyway?" treatment in
 * moderation.js. A link counts as an application link when:
 *
 *   - its host is a leasing or application portal (APPLICATION_PORTAL_HOSTS), or
 *   - the URL itself says apply / application / applicant.
 *
 * Words around a link no longer count on their own (Wyatt, 2026-11-23): "photos
 * are at ..., let me know if you apply" is not an application, so a link that
 * only sits near the word "apply" gets the ordinary "send anyway?" prompt.
 *
 * Pure: no imports beyond moderation's allowlist, so it can be unit tested.
 */
import { ALLOWED_LINK_HOSTS } from "./moderation.js";

export const APPLICATION_LINK_CODE = "APPLICATION_LINK";
export const APPLICATION_LINK_REASON = "application_link";

/*
 * Hosts whose links are, in practice, a leasing portal or an application.
 * Subdomains count ("westpine.rentcafe.com"). General listing sites (Zillow,
 * Apartments.com) and form builders (Google Forms, Jotform) are left to the
 * keyword checks, since most of their links are not applications.
 */
export const APPLICATION_PORTAL_HOSTS = [
  "rentcafe.com",
  "securecafe.com",
  "appfolio.com",
  "buildium.com",
  "managebuilding.com",
  "entrata.com",
  "residentportal.com",
  "realpage.com",
  "yardi.com",
  "rentspree.com",
  "turbotenant.com",
  "avail.co",
  "rentredi.com",
  "tenantcloud.com",
  "doorloop.com",
  "rentmanager.com",
  "propertyware.com",
  "rentecdirect.com",
  "innago.com",
  "mysmartmove.com",
  "rentvine.com",
  "hemlane.com",
  "cozy.co",
];

// A web address: an explicit http(s) URL, or a bare host on a known TLD with
// any path. The TLD list is explicit so "St. Louis" and "1.5 baths" do not count.
// Further labels after the TLD are part of the host ("mysite.co.uk"), so the
// whole link is matched and removed, never just its front.
const URL_CANDIDATE =
  /\bhttps?:\/\/[^\s<>()"']+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|info|xyz|ru|cn|edu|gov|us|app|dev|me|biz|site|online|link|shop|rentals|apartments|properties|homes|management|ai)(?:\.[a-z]{2,})*\b(?:\/[^\s<>()"']*)?/gi;

// In the URL: "apply", "application", "applicant" anywhere ("/onlineapplication",
// "applynow"), and "rental-app" / "rentalapp".
const URL_KEYWORD = /apply|application|applicant|rental-?app\b/i;

function hostOf(url) {
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const onHost = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));

// Trailing punctuation a sentence puts after a link is not part of it.
const trimUrl = (raw) => raw.replace(/[.,;:!?]+$/, "");

/*
 * Every application link in a message, with where it sits: { url, start, end }.
 * `url` is the whole link as written, from its scheme (if any) to the end of
 * its path, less trailing sentence punctuation.
 */
function applicationLinkSpans(text) {
  const body = String(text ?? "");
  const found = [];
  for (const match of body.matchAll(URL_CANDIDATE)) {
    const url = trimUrl(match[0]);
    // An email address's domain is not a link ("leasing@rentcafe.com").
    if (body[match.index - 1] === "@") continue;
    const host = hostOf(url);
    if (!host || onHost(host, ALLOWED_LINK_HOSTS)) continue;
    const start = match.index;
    const end = start + url.length;
    if (onHost(host, APPLICATION_PORTAL_HOSTS) || URL_KEYWORD.test(url)) found.push({ url, start, end });
  }
  return found;
}

/**
 * Every application link in a message, as written.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function findApplicationLinks(text) {
  return applicationLinkSpans(text).map((s) => s.url);
}

export const hasApplicationLink = (text) => applicationLinkSpans(text).length > 0;

/**
 * The message with each application link replaced by "[removed]", for replies
 * that arrive by email (which cannot be bounced back for an edit). Only the
 * link itself goes, whole, at the exact place it was found: no surrounding
 * words, and never the same text inside another link (Wyatt, 2026-11-22).
 */
export function stripApplicationLinks(text) {
  const body = String(text ?? "");
  let out = body;
  // From the end, so earlier positions stay valid.
  for (const { start, end } of applicationLinkSpans(body).reverse()) {
    out = `${out.slice(0, start)}[removed]${out.slice(end)}`;
  }
  return out;
}

/** Where the landlord sets the link: the property in their dashboard, scrolled to the field. */
export function applicationLinkSettingsPath(listingId) {
  const p = new URLSearchParams({ tab: "properties" });
  if (listingId) p.set("property", listingId);
  p.set("focus", "application-link");
  return `/dashboard/landlord?${p.toString()}`;
}

/*
 * Where the landlord stands on this listing, which decides what they are told
 * (Wyatt, 2026-11-23):
 *
 *   live       a link is saved on a lease students can see, so the Apply button shows
 *   saved      a link is saved, but none of those leases are live yet
 *   missing    they have leases here, none with a link
 *   no_leases  no leases of their own here, so the dashboard field is greyed out
 */
export const APPLICATION_LINK_STATES = ["live", "saved", "missing", "no_leases"];

const RULE = "Sending applications through chat isn't allowed.";
const CONTACT_TAB = "students can fill out your application directly from the listing's Contact tab";

const COPY = {
  live: {
    message: `${RULE} Your application link is already on this listing, so ${CONTACT_TAB}. You can change the link in your dashboard.`,
    actionLabel: "View your application link",
  },
  saved: {
    message: `${RULE} Your application link is saved, but none of your units at this property are live yet, so students don't see an Apply button. Publish a unit and ${CONTACT_TAB}.`,
    actionLabel: "Open this property",
  },
  missing: {
    message: `${RULE} Add your application link to this listing in your dashboard instead, and ${CONTACT_TAB}.`,
    actionLabel: "Add your application link",
  },
  no_leases: {
    message: `${RULE} Add a lease for this property in your dashboard first, then add your application link to it, and ${CONTACT_TAB}.`,
    actionLabel: "Open this property",
  },
};

/**
 * What the landlord is told, and the label for the dashboard button.
 *
 * @param {"live"|"saved"|"missing"|"no_leases"} state
 * @returns {{ message: string, actionLabel: string }}
 */
export function applicationLinkCopy(state = "missing") {
  return COPY[state] ?? COPY.missing;
}

/**
 * The state from the landlord's own leases at the property, each with its
 * unit: { application_url, is_active, unavailable, published_at,
 * listing_units: { published_at, deleted_at } }. Pure so it can be tested.
 */
export function applicationLinkStateOf(leases) {
  const rows = (leases ?? []).filter((l) => !l?.deleted_at && !l?.listing_units?.deleted_at);
  if (rows.length === 0) return "no_leases";
  const withLink = rows.filter((l) => String(l.application_url ?? "").trim());
  if (withLink.length === 0) return "missing";
  const live = withLink.some(
    (l) => l.is_active && !l.unavailable && l.published_at !== null && l.listing_units?.published_at !== null
  );
  return live ? "live" : "saved";
}
