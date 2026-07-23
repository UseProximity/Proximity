import { track } from "@vercel/analytics";
import { sendGAEvent } from "@next/third-parties/google";

export function trackEvent(eventName, props = {}) {
  try { track(eventName, props); } catch {}
  try { sendGAEvent("event", eventName, props); } catch {}
}

/* ── Cross-page navigation source ──
 * Header records each route change so any page can ask "where did the user
 * come from?" (client-side navigations don't update document.referrer). */
const PREV_PATH_KEY = "prx_prev_path";
const CURR_PATH_KEY = "prx_curr_path";

export function recordPageVisit(pathname) {
  try {
    const curr = sessionStorage.getItem(CURR_PATH_KEY);
    if (curr === pathname) return;
    if (curr) sessionStorage.setItem(PREV_PATH_KEY, curr);
    sessionStorage.setItem(CURR_PATH_KEY, pathname);
  } catch {}
}

export function getPreviousPath(currentPath) {
  try {
    // A page's mount effect can run before the header records the new route; in
    // that window the stored "current" path is actually the page we came from.
    const curr = sessionStorage.getItem(CURR_PATH_KEY);
    if (currentPath && curr && curr !== currentPath) return curr;
    return sessionStorage.getItem(PREV_PATH_KEY) || "direct";
  } catch {
    return "direct";
  }
}

/* ── Listing attribution ──
 * When a listing is opened from a matchmaking card, remember it for this tab so
 * downstream actions (save, contact) can carry a `source` on their events. */
const listingSourceKey = (listingId) => `prx_listing_src_${listingId}`;

export function setListingSource(listingId, source) {
  try { sessionStorage.setItem(listingSourceKey(listingId), source); } catch {}
}

export function getListingSource(listingId) {
  try { return sessionStorage.getItem(listingSourceKey(listingId)) || null; } catch { return null; }
}
