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
 *   - the URL itself says apply / application / applicant, or
 *   - the sentence it sits in (or the line just before a link on its own line,
 *     as in "Here is our application:\nhttps://...") talks about applying.
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

// In the words around it.
const TEXT_KEYWORD =
  /\b(?:apply|applying|application|applications|applicant|applicants|app fee|application fee|rental app|fill(?:ing)? out (?:the|an|our|my) app)\b/i;

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
 * The sentence holding the match, and the one before it when the link stands
 * alone ("Our application:" then the link on the next line).
 */
function contextFor(text, start, end) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  // A sentence ends at a newline or at . ! ? followed by whitespace. URLs hold
  // no whitespace, so their own dots never split them.
  const lead = before.split(/\n|[.!?](?=\s)/).pop() ?? "";
  const tail = after.split(/\n|[.!?](?=\s)/)[0] ?? "";
  const own = `${lead} ${tail}`;
  if (own.replace(/[\s:;,\-()]+/g, "").length > 0) return own;
  // The link is alone: take the previous non-empty sentence or line.
  const previous = before
    .split(/\n|[.!?](?=\s)/)
    .slice(0, -1)
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  return previous ?? "";
}

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
    const isApplication =
      onHost(host, APPLICATION_PORTAL_HOSTS) ||
      URL_KEYWORD.test(url) ||
      TEXT_KEYWORD.test(contextFor(body, start, end));
    if (isApplication) found.push({ url, start, end });
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

/**
 * What the landlord is told. `hasLink`: they already have an application link
 * on this listing, so students can already apply from it.
 */
export function applicationLinkMessage({ hasLink = false } = {}) {
  const rule = "Sending applications through chat isn't allowed.";
  return hasLink
    ? `${rule} Your application link is already on this listing, so students can fill out your application directly from the listing's Contact tab. You can change the link in your dashboard.`
    : `${rule} Add your application link to this listing in your dashboard instead, and students can fill out your application directly from the listing's Contact tab.`;
}
