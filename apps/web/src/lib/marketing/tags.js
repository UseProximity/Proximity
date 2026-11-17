/*
 * The one tag cleaner every campaign value goes through: utm_* parameters, the
 * src QR parameter, campaign link slugs and their labels.
 *
 * Tags are typed by hand in ad tools, printed on flyers and mangled by link
 * rewriters, so anything can arrive. They end up in DB columns and in analytics
 * event props, so they are normalized to one boring shape rather than trusted:
 * lowercase, letters/digits/dash/underscore, 40 characters max.
 *
 * Moved here from lib/reviews/source.js (which still re-exports it for the
 * review flow). Shared by client and server; keep it free of server-only and
 * "@/" imports so the Node test runner can load it directly.
 */

export const MAX_TAG_LENGTH = 40;

/** A safe tag, or null when there's nothing usable in `raw`. */
export function normalizeTag(raw) {
  const lowered = String(raw ?? "").trim().toLowerCase();
  if (!lowered) return null;
  const cleaned = lowered
    .replace(/[^a-z0-9_-]+/g, "-") // spaces, punctuation, anything exotic
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return cleaned ? cleaned.slice(0, MAX_TAG_LENGTH) : null;
}

/*
 * Clean a value and report whether cleaning changed it beyond lowercasing
 * ("Instagram" -> "instagram" is just case; "spring lease!" -> "spring-lease"
 * or a 60-character tag cut to 40 is a real change). The Data quality block
 * counts the real changes.
 */
export function cleanTag(raw) {
  const value = normalizeTag(raw);
  const lowered = String(raw ?? "").trim().toLowerCase();
  return { value, changed: Boolean(lowered) && value !== lowered };
}

/*
 * The query parameters a visit's campaign is read from (PRD 7.1). A
 * server-side redirect between our own pages must carry them, or the browser
 * beacon on the page the visitor ends up on never sees them: /messages, for
 * one, redirects every chat email link to the inbox overlay.
 */
export const CAMPAIGN_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "src", "gclid"];

/**
 * `path` (a same-site path) with the campaign parameters from `params` (a
 * Next.js searchParams object) appended. Values already on `path` win, and
 * the path is returned unchanged when there is nothing to carry.
 */
export function withCampaignParams(path, params) {
  const carried = [];
  for (const name of CAMPAIGN_PARAMS) {
    const raw = params?.[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && value) carried.push([name, value.slice(0, 200)]);
  }
  if (!carried.length || typeof path !== "string") return path;
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const queryAt = base.indexOf("?");
  const query = new URLSearchParams(queryAt >= 0 ? base.slice(queryAt + 1) : "");
  for (const [name, value] of carried) if (!query.has(name)) query.set(name, value);
  const pathname = queryAt >= 0 ? base.slice(0, queryAt) : base;
  return `${pathname}?${query.toString()}${hash}`;
}
