/*
 * Decide which campaign a visit came from (PRD 7.1). Pure: no DB, no request
 * objects, so every rule is unit-tested. The beacon route resolves the
 * registered campaign link (if any) and passes it in.
 *
 * Rules, applied in this order:
 *   1. src matches a registered campaign link: use the link's labels and
 *      store its id. A link wins over any UTMs on the same URL.
 *   2. utm_* present: use them as given (cleaned).
 *   3. src present but not registered: qr / offline / <src>.
 *   4. gclid present with no UTMs: google / cpc.
 *   5. Nothing tagged: classify from the referring host; our own domain or
 *      no referrer is direct / none.
 * gclid is stored whenever present, whichever rule applied.
 *
 * Shared by client and server; no "@/" imports (Node test runner loads it).
 */
import { cleanTag, normalizeTag } from "./tags.js";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

// Known referring hosts, matched on the registrable domain so subdomains
// (l.instagram.com, m.facebook.com, www.google.co.uk) land on the same source.
const REFERRER_RULES = [
  // Social
  { match: ["instagram.com"], source: "instagram", medium: "organic-social" },
  { match: ["facebook.com", "fb.com", "fb.me", "messenger.com"], source: "facebook", medium: "organic-social" },
  { match: ["tiktok.com"], source: "tiktok", medium: "organic-social" },
  { match: ["twitter.com", "x.com", "t.co"], source: "x", medium: "organic-social" },
  { match: ["threads.net", "threads.com"], source: "threads", medium: "organic-social" },
  { match: ["linkedin.com", "lnkd.in"], source: "linkedin", medium: "organic-social" },
  { match: ["reddit.com"], source: "reddit", medium: "organic-social" },
  { match: ["snapchat.com"], source: "snapchat", medium: "organic-social" },
  { match: ["youtube.com", "youtu.be"], source: "youtube", medium: "organic-social" },
  { match: ["pinterest.com"], source: "pinterest", medium: "organic-social" },
  { match: ["sidechat.lol", "sidechat.com"], source: "sidechat", medium: "organic-social" },
  { match: ["discord.com", "discord.gg"], source: "discord", medium: "organic-social" },
  { match: ["groupme.com"], source: "groupme", medium: "organic-social" },
  // Email (checked before search so mail.google.com is not "google")
  { match: ["mail.google.com"], source: "gmail", medium: "email" },
  { match: ["outlook.live.com", "outlook.office.com", "outlook.office365.com"], source: "outlook", medium: "email" },
  { match: ["mail.yahoo.com"], source: "yahoo-mail", medium: "email" },
  // Search
  { match: ["google.*"], source: "google", medium: "organic-search" },
  { match: ["bing.com"], source: "bing", medium: "organic-search" },
  { match: ["duckduckgo.com"], source: "duckduckgo", medium: "organic-search" },
  { match: ["search.yahoo.com", "yahoo.com"], source: "yahoo", medium: "organic-search" },
  { match: ["ecosia.org"], source: "ecosia", medium: "organic-search" },
  { match: ["search.brave.com"], source: "brave", medium: "organic-search" },
  { match: ["chatgpt.com", "chat.openai.com"], source: "chatgpt", medium: "referral" },
  { match: ["perplexity.ai"], source: "perplexity", medium: "referral" },
];

const DEFAULT_OWN_HOSTS = ["useproximity.org"];

/** Lowercased host of a referrer URL (or bare host), "www." dropped, or null. */
export function referrerHost(referrer) {
  const raw = String(referrer ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

function hostMatches(host, pattern) {
  if (pattern.endsWith(".*")) {
    // "google.*": google.com, google.co.uk, www.google.de, but not googleblog.com
    const base = pattern.slice(0, -2);
    return new RegExp(`(^|\\.)${base.replace(/\./g, "\\.")}\\.[a-z.]{2,6}$`).test(host);
  }
  return host === pattern || host.endsWith(`.${pattern}`);
}

function isOwnHost(host, ownHosts) {
  if (host === "localhost" || host.startsWith("127.") || host.endsWith(".vercel.app")) return true;
  return ownHosts.some((own) => host === own || host.endsWith(`.${own}`));
}

/** source / medium for an untagged visit, from where it was referred. */
export function classifyReferrer(referrer, ownHosts = DEFAULT_OWN_HOSTS) {
  const host = referrerHost(referrer);
  if (!host || isOwnHost(host, ownHosts)) {
    return { source: "direct", medium: "none", classified_from: "direct", referrer_host: null };
  }
  const rule = REFERRER_RULES.find((r) => r.match.some((p) => hostMatches(host, p)));
  if (rule) return { source: rule.source, medium: rule.medium, classified_from: "referrer", referrer_host: host };
  // Unknown site: keep the host itself as the source so it is still readable.
  return { source: normalizeTag(host) || "unknown", medium: "referral", classified_from: "referrer", referrer_host: host };
}

/** Read a param off URLSearchParams, a query string or a plain object. */
function paramGetter(params) {
  if (!params) return () => null;
  if (typeof params === "string") {
    const sp = new URLSearchParams(params.startsWith("?") ? params.slice(1) : params);
    return (k) => sp.get(k);
  }
  if (typeof params.get === "function") return (k) => params.get(k);
  return (k) => (params[k] == null ? null : String(params[k]));
}

/** Google click ids are case-sensitive opaque strings: keep, but bound them. */
export function cleanGclid(raw) {
  const v = String(raw ?? "").trim();
  if (!v || v.length > 200 || !/^[A-Za-z0-9_-]+$/.test(v)) return null;
  return v;
}

/**
 * The campaign parameters on a URL, cleaned. `srcTag` is the normalized src
 * (the beacon looks it up as a campaign link slug before calling classifyVisit).
 */
export function readCampaignParams(params) {
  const get = paramGetter(params);
  let cleaned = false;
  const utm = {};
  for (const key of UTM_KEYS) {
    const { value, changed } = cleanTag(get(key));
    if (value) utm[key] = value;
    if (changed) cleaned = true;
  }
  const src = cleanTag(get("src"));
  if (src.changed) cleaned = true;
  return { utm, srcTag: src.value, gclid: cleanGclid(get("gclid")), cleaned };
}

/** True when the URL carries any campaign signal (decides touchpoints). */
export function hasCampaignSignal(params) {
  const { utm, srcTag, gclid } = readCampaignParams(params);
  return Boolean(srcTag || gclid || Object.keys(utm).length);
}

/**
 * Classify a visit.
 * @param {object} input
 * @param {URLSearchParams|string|object} input.params  landing URL query
 * @param {string} [input.referrer]  document.referrer of the landing page
 * @param {object|null} [input.link]  the registered marketing_links row whose
 *   slug equals the src tag, or null
 * @param {string[]} [input.ownHosts]  our own domains (treated as direct)
 * @returns the marketing_sessions attribution fields
 */
export function classifyVisit({ params, referrer, link = null, ownHosts = DEFAULT_OWN_HOSTS } = {}) {
  const { utm, srcTag, gclid, cleaned } = readCampaignParams(params);
  const ref = classifyReferrer(referrer, ownHosts);
  const base = { gclid, referrer_host: ref.referrer_host, tags_cleaned: cleaned, link_id: null, src_tag: srcTag };

  // 1. Registered campaign link.
  if (srcTag && link && link.slug === srcTag) {
    return {
      ...base,
      source: link.source,
      medium: link.medium,
      campaign: link.campaign ?? null,
      content: link.content ?? null,
      term: null,
      classified_from: "link",
      link_id: link.id,
    };
  }

  // 2. UTMs. A missing source or medium is filled from the referrer so the
  //    row is still readable; the campaign the admin typed is kept.
  if (Object.keys(utm).length) {
    return {
      ...base,
      source: utm.utm_source || ref.source,
      medium: utm.utm_medium || (utm.utm_source ? "unknown" : ref.medium),
      campaign: utm.utm_campaign ?? null,
      content: utm.utm_content ?? null,
      term: utm.utm_term ?? null,
      classified_from: "utm",
    };
  }

  // 3. Unregistered src (printed review QR codes, typos).
  if (srcTag) {
    return { ...base, source: "qr", medium: "offline", campaign: srcTag, content: null, term: null, classified_from: "src" };
  }

  // 4. Google Ads click without UTMs.
  if (gclid) {
    return { ...base, source: "google", medium: "cpc", campaign: null, content: null, term: null, classified_from: "gclid" };
  }

  // 5. Untagged: referrer or direct.
  return {
    ...base,
    source: ref.source,
    medium: ref.medium,
    campaign: null,
    content: null,
    term: null,
    classified_from: ref.classified_from,
  };
}
