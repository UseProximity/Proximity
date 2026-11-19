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

import { MAX_TAG_LENGTH, normalizeTag } from "../marketing/tags.js";
import { EMAIL_SOURCE as OWN_EMAIL_SOURCE } from "../marketing/emailLinks.js";

export const MAX_SOURCE_LENGTH = MAX_TAG_LENGTH;

/**
 * A safe campaign tag, or null when there's nothing usable in `raw`. The
 * cleaner itself lives in lib/marketing/tags.js so marketing attribution and
 * the review flow normalize tags identically.
 */
export function normalizeReviewSource(raw) {
  return normalizeTag(raw);
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
  // Links in our own emails carry utm_source=proximity-email and the email
  // kind as utm_campaign (marketing attribution). That marks the email click
  // for marketing; it is not a printed code, so the review keeps no tag.
  const own = normalizeReviewSource(get("utm_source")) === OWN_EMAIL_SOURCE;
  return normalizeReviewSource(
    get("src") || (own ? null : get("utm_campaign") || get("utm_source"))
  );
}

/** How a QR-born account's referral_source reads in the admin Users view. */
export function referralSourceLabel(source) {
  return source ? `qr:${source}` : "Review flow";
}
