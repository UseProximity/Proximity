/*
 * The campaign tag a printed QR code carries: /r?src=<tag>.
 *
 * The tag is invented at print time ("flyer-mudd", "table-dbf", "insta-story-1")
 * and never registered anywhere first, so anything can arrive here. It ends up in
 * a DB column and in analytics event props, so it is normalized to one boring
 * shape rather than trusted: lowercase, letters/digits/dash/underscore, capped.
 *
 * Shared by client and server; keep it free of server-only imports.
 */

export const MAX_SOURCE_LENGTH = 40;

/** A safe campaign tag, or null when there's nothing usable in `raw`. */
export function normalizeReviewSource(raw) {
  const lowered = String(raw ?? "").trim().toLowerCase();
  if (!lowered) return null;
  const cleaned = lowered
    .replace(/[^a-z0-9_-]+/g, "-") // spaces, punctuation, anything exotic
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return cleaned ? cleaned.slice(0, MAX_SOURCE_LENGTH) : null;
}

/*
 * Read the tag off a URLSearchParams (client) or a plain object (server page
 * props). `src` is what our own QR codes use because a shorter URL prints as a
 * lower-density code; utm_* are accepted so a code minted by a third-party
 * generator that rewrites links still attributes.
 */
export function readReviewSource(params) {
  if (!params) return null;
  const get =
    typeof params.get === "function" ? (k) => params.get(k) : (k) => params[k];
  return normalizeReviewSource(
    get("src") || get("utm_campaign") || get("utm_source")
  );
}

/** How a QR-born account's referral_source reads in the admin Users view. */
export function referralSourceLabel(source) {
  return source ? `qr:${source}` : "Review flow";
}
