/*
 * Campaign tags on links in our own emails (PRD 7.5): utm_source=proximity-email,
 * utm_medium=email, utm_campaign=<email kind>.
 *
 * Applied once, in sendMailSafe, to student-facing emails only, so each sender
 * does not have to build tagged URLs itself. A landlord clicking through from
 * an email is not a marketing visit and must not count as one:
 *   - STUDENT_EMAIL_KINDS only ever go to students (or parents): always tagged
 *   - SHARED_EMAIL_KINDS go to students AND landlords (chat alerts, tour
 *     emails, mass email): tagged only when the sender sets
 *     logAs.audience to "student" or "parent". Anything unmarked stays
 *     untagged, so a missed sender is never counted. Only links to our own site are tagged.
 * Left alone:
 *   - /api/ links: one-click endpoints (unsubscribe, waitlist hand-off) that
 *     never load a page, so the tags would do nothing there
 *   - links that already carry a utm_source (a mass email author's own tags)
 *   - mailto:, tel: and every other site
 * Account emails (verification, password reset), billing and team emails are
 * not tagged: they are not marketing touchpoints, and their token links are
 * best left exactly as issued.
 *
 * Under the session rule (D4) a tagged link only starts a new session when the
 * old one has expired; inside a live paid session it is a touchpoint.
 *
 * Pure; no "@/" imports (Node test runner loads it).
 */

export const EMAIL_SOURCE = "proximity-email";
export const EMAIL_MEDIUM = "email";

export const STUDENT_EMAIL_KINDS = new Set([
  // Proxy's emails to the student who asked
  "proxy_answer",
  "proxy_relay",
  "proxy_clarifier",
  "proxy_correction",
  "proxy_reply",
  "proxy_no_answer",
  // tour emails that only go to the student
  "tour_proposal",
  "tour_no_answer",
  // review invites and the review / waitlist follow-ups
  "review_invite",
  "review_confirmation",
  "waitlist_nudge",
  "parent_guide",
]);

export const SHARED_EMAIL_KINDS = new Set([
  "chat_alert",
  "chat_reminder",
  "tour_confirmed",
  "tour_cancelled",
  "tour_reminder",
  "mass_email",
]);

const MARKETING_AUDIENCES = new Set(["student", "parent"]);

/** Every kind that can be tagged (for tests and docs). */
export const TAGGED_EMAIL_KINDS = new Set([...STUDENT_EMAIL_KINDS, ...SHARED_EMAIL_KINDS]);

/** Whether an email of this kind, to this audience, gets campaign tags. */
export function shouldTagEmail(kind, audience = null) {
  if (STUDENT_EMAIL_KINDS.has(kind)) return true;
  return SHARED_EMAIL_KINDS.has(kind) && MARKETING_AUDIENCES.has(audience);
}

const OWN_HOSTS = new Set(["useproximity.org", "localhost", "127.0.0.1"]);

function ownHost(host, extraHosts) {
  const h = String(host || "").toLowerCase();
  return OWN_HOSTS.has(h) || h.endsWith(".useproximity.org") || h.endsWith(".vercel.app") || extraHosts.has(h);
}

/** The url with our email tags added, or the url unchanged when it is not ours to tag. */
export function tagUrl(url, kind, extraHosts = new Set()) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return url;
  if (!ownHost(u.hostname, extraHosts)) return url;
  if (u.pathname === "/api" || u.pathname.startsWith("/api/")) return url;
  if (u.searchParams.has("utm_source")) return url;
  u.searchParams.set("utm_source", EMAIL_SOURCE);
  u.searchParams.set("utm_medium", EMAIL_MEDIUM);
  u.searchParams.set("utm_campaign", kind);
  return u.toString();
}

// href values in HTML. Entities inside the URL (&amp;) are decoded for parsing
// and the tagged URL is written back with & escaped again.
const HREF_RE = /(href\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi;
// Bare URLs in the plain-text part.
const TEXT_URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

function hostsFrom(baseUrls) {
  const set = new Set();
  for (const b of baseUrls || []) {
    try {
      set.add(new URL(b).hostname.toLowerCase());
    } catch {
      // ignore an unusable base URL
    }
  }
  return set;
}

export function tagHtmlLinks(html, kind, baseUrls = []) {
  if (typeof html !== "string" || !html) return html;
  const extra = hostsFrom(baseUrls);
  return html.replace(HREF_RE, (whole, attr, quote, raw) => {
    const decoded = raw.replace(/&amp;/g, "&");
    const tagged = tagUrl(decoded, kind, extra);
    if (tagged === decoded) return whole;
    return `${attr}${quote}${tagged.replace(/&/g, "&amp;")}${quote}`;
  });
}

export function tagTextLinks(text, kind, baseUrls = []) {
  if (typeof text !== "string" || !text) return text;
  const extra = hostsFrom(baseUrls);
  return text.replace(TEXT_URL_RE, (raw) => {
    // A sentence's closing full stop or comma is not part of the link.
    const trail = raw.match(/[.,;:!?]+$/)?.[0] ?? "";
    const url = trail ? raw.slice(0, -trail.length) : raw;
    return `${tagUrl(url, kind, extra)}${trail}`;
  });
}

/**
 * A copy of the mail message with its links tagged, or the message itself
 * when the kind (and, for shared kinds, the audience) is not one we tag.
 */
export function tagEmailMessage(message, kind, baseUrls = [], audience = null) {
  if (!message || !shouldTagEmail(kind, audience)) return message;
  const out = { ...message };
  if (typeof message.html === "string") out.html = tagHtmlLinks(message.html, kind, baseUrls);
  if (typeof message.text === "string") out.text = tagTextLinks(message.text, kind, baseUrls);
  return out;
}
