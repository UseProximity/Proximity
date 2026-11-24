// The link a listing share sends. It matches web's link
// (apps/web/src/utils/shareLink.js), the public listing page
// <origin>/listings/<id>?src=share, except that it carries no ?unit=, so the
// listing opens on its default unit. The src=share tag is what makes the web
// marketing beacon count the recipient's visit as a share rather than a QR scan
// (apps/web/src/lib/marketing/classify.js). The link always opens on the web:
// /listings is not a universal-link path, so the beacon runs and the visit is counted.
//
// The origin follows the backend this build talks to, as web's follows the site it
// is served from: a build on the staging API shares staging links (its listings come
// from the dev database), and every other build shares production links.
//
// CommonJS on purpose, like linkDomains.js, so `npm test` can require it.

const { PRODUCTION_LINK_HOST, STAGING_LINK_HOST } = require("./linkDomains");

const SHARE_SRC = "share";

// Lowercased host of an https URL, or null.
function httpsHost(value) {
  if (typeof value !== "string") return null;
  const match = /^https:\/\/([^/?#@:]+)(?::\d+)?(?:[/?#]|$)/i.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

function shareOriginFor(apiUrl) {
  const host = httpsHost(apiUrl) === STAGING_LINK_HOST ? STAGING_LINK_HOST : PRODUCTION_LINK_HOST;
  return `https://${host}`;
}

function buildShareUrl({ origin, listingId } = {}) {
  if (!origin || !listingId) return "";
  return `${origin.replace(/\/+$/, "")}/listings/${encodeURIComponent(listingId)}?src=${SHARE_SRC}`;
}

// The line sent with the link. It matches web's wording, with a mobile-only
// fallback to the address when there is no title.
function shareMessage({ title, address } = {}) {
  const name = (typeof title === "string" && title.trim()) || (typeof address === "string" && address.trim()) || "";
  return name ? `${name} on Proximity` : "Check out this listing on Proximity";
}

module.exports = { SHARE_SRC, shareOriginFor, buildShareUrl, shareMessage };
