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

/* ── Find Your Place matches seen again ──
 * Did a student come back to a listing Find Your Place showed them, but not
 * through the matches page (browse, search, a shared link, days later)? The
 * matches are remembered on this browser, signed in or not, and opening,
 * saving or contacting one of them by any other route fires
 * "Find Your Place Match Revisited" (Wyatt, 2026-11-15). Per browser on
 * purpose: one IP is shared by a whole dorm on the campus network. */
const FYP_SHOWN_KEY = "prx_fyp_shown";
const FYP_SHOWN_MAX = 60;
const FYP_REVISIT_TAB_KEY = "prx_fyp_revisited";

function readShown() {
  try {
    const raw = JSON.parse(localStorage.getItem(FYP_SHOWN_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function rememberMatchesShown(listingIds) {
  try {
    const shown = readShown();
    const now = new Date().toISOString();
    for (const id of listingIds) if (id && !shown[id]) shown[id] = now;
    // Oldest first; keep only the most recent.
    const kept = Object.entries(shown).sort((a, b) => a[1].localeCompare(b[1])).slice(-FYP_SHOWN_MAX);
    localStorage.setItem(FYP_SHOWN_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {}
}

// action: "opened" | "saved" | "contacted" | "waitlist"
export function noteMatchRevisit(listingId, action) {
  try {
    // Opened from the matches page itself: that is the ordinary funnel, not a revisit.
    // A heart tapped on the matches page itself is part of it too.
    if (!listingId || getListingSource(listingId) === "matchmaking") return;
    if (window.location.pathname.startsWith("/find-your-place")) return;
    const shownAt = readShown()[listingId];
    if (!shownAt) return;
    // An open counts once per tab, so closing and reopening the panel is one visit.
    if (action === "opened") {
      const seen = JSON.parse(sessionStorage.getItem(FYP_REVISIT_TAB_KEY) ?? "[]");
      if (seen.includes(listingId)) return;
      sessionStorage.setItem(FYP_REVISIT_TAB_KEY, JSON.stringify([...seen, listingId].slice(-FYP_SHOWN_MAX)));
    }
    const daysSince = Math.max(0, Math.floor((Date.now() - Date.parse(shownAt)) / 86_400_000));
    trackEvent("Find Your Place Match Revisited", { listingId, action, daysSince });
  } catch {}
}
