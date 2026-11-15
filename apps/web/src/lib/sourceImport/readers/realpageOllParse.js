/*
 * RealPage Online Leasing: the parts that need no network.
 *
 * Kept apart from realpageOll.js so node --test can load them without the
 * app's path aliases. See that file for what the portal is and how it is
 * walked.
 */

// The numbered landing page every RealPage property has.
export const REALPAGE_OLL_RE = /https?:\/\/(\d{5,9})\.onlineleasing\.realpage\.com/i;
// The leasing app itself, opened by site number.
const OLL_APP_RE = /https?:\/\/oll-leasing\.loftliving\.com\/oll\/?\?[^"'\s<>]*?\bsiteId=(\d{5,9})/i;
// Worth one extra page fetch to look for the portal link.
export const REALPAGE_OLL_HINT_RE = /apts247|apartments247|onlineleasing|realpage/i;

/* Portal coordinates from any page HTML: { propertyId } or { siteId }, or null. */
export function findRealPageOll(html) {
  if (!html) return null;
  const source = String(html).replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const app = source.match(OLL_APP_RE);
  if (app) return { propertyId: null, siteId: app[1] };
  const landing = source.match(REALPAGE_OLL_RE);
  if (landing) return { propertyId: landing[1], siteId: null };
  return null;
}

/* The site number the landing page hands its leasing app. */
export function siteIdFromLanding(html) {
  return String(html ?? "").match(/\bsiteId=(\d{5,9})\b/i)?.[1] ?? null;
}

export const appUrl = (siteId) => `https://oll-leasing.loftliving.com/oll/?siteId=${encodeURIComponent(siteId)}`;

// The shape every walked portal shares (readers/portalWalkParse.js).
export { sayDate, feeLine, offersFor, mergeSameRent, unitsFromWalk, mergeWalk, nextSundayCheckAt } from "./portalWalkParse.js";
