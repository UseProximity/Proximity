/*
 * A lease check that's been uploaded but not yet analyzed because the uploader
 * wasn't signed in.
 *
 * Signing in or up leaves the page (Google is a full redirect, password sign-in
 * reloads via window.location, email verification goes through an inbox link), so
 * what's needed to resume has to outlive the page the same way lib/listings/pendingDraft
 * does for Add Listing. Unlike that draft, the lease itself is already sitting in R2 by
 * the time this is saved (see api/lease-check/route.js) — all that has to survive the
 * trip is the id and the object keys needed to trigger analysis on the way back.
 *
 * Deliberately NOT keyed by user: it's written before anyone is signed in.
 *
 * Every access is wrapped. Private windows and blocked site data throw on storage
 * access, and the flow must still work (just without surviving a reload).
 */

const KEY = "proximity:pending-lease-check";
const VERSION = 1;
// R2's lifecycle rule expires lease-checks/tmp/ objects after 1 day (route.js); stay
// comfortably inside that so a resume never points at objects that are already gone.
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function savePendingCheck(pending) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...pending, v: VERSION, savedAt: Date.now() })
    );
    return true;
  } catch {
    return false;
  }
}

/** The saved pending check, or null if there is none, it is stale, or it is unreadable. */
export function loadPendingCheck() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    const fresh = Date.now() - (pending?.savedAt ?? 0) < MAX_AGE_MS;
    if (
      pending?.v !== VERSION ||
      !fresh ||
      !pending.leaseCheckId ||
      !Array.isArray(pending.keys) ||
      pending.keys.length === 0
    ) {
      clearPendingCheck();
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

export function clearPendingCheck() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
