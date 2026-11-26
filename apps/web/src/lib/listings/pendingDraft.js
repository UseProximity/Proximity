/*
 * A listing someone has finished describing but not yet published.
 *
 * Add Listing lets a signed-out visitor fill the whole form and only asks for an
 * account when they press Publish. Signing in or up leaves the page (Google is a
 * full redirect, password login reloads, email verification goes through an
 * inbox), so what they typed has to outlive the page. It lives in localStorage
 * and is put back by AddListingFlow once they come back signed in.
 *
 * Deliberately NOT keyed by user: its author is anonymous when it is written.
 * That means contact details sit in the browser until the listing is published,
 * discarded, or older than MAX_AGE_MS, so a shared computer does not keep one
 * indefinitely.
 *
 * Only plain answers are stored, never the address lookup: a property or unit id
 * saved now can be gone by the time they return, so the flow looks the address
 * up again on restore and re-matches the unit by id.
 *
 * Every access is wrapped. Private windows and blocked site data throw on
 * storage access, and a form that cannot save a draft must still work.
 */

const KEY = "proximity:pending-listing";
const VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function savePendingDraft(draft) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...draft, v: VERSION, savedAt: Date.now() })
    );
    return true;
  } catch {
    return false;
  }
}

/** The saved draft, or null if there is none, it is stale, or it is unreadable. */
export function loadPendingDraft() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    const fresh = Date.now() - (draft?.savedAt ?? 0) < MAX_AGE_MS;
    if (draft?.v !== VERSION || !fresh || !draft.address || !draft.lease) {
      clearPendingDraft();
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function clearPendingDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
