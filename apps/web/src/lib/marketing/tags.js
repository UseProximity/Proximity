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
