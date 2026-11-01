"use client";

/*
 * One landlord-side change (a question answered, a tour picked, an answer
 * that came in by email) shows everywhere at once (Wyatt, 2026-11-01): the
 * Questions tab and its count, the sidebar badges, the Messages inbox and
 * any other open copy of the listing's chat all listen for this.
 */
export const LANDLORD_SYNC = "proxy:landlord-changed";

export function announceLandlordChange(detail = {}) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(LANDLORD_SYNC, { detail }));
}

export function onLandlordChange(fn) {
  window.addEventListener(LANDLORD_SYNC, fn);
  return () => window.removeEventListener(LANDLORD_SYNC, fn);
}

/*
 * A conversation appeared or changed outside the inbox's own feed: a tour
 * opened a direct chat with the landlord, or Proxy relayed an answer. The
 * Messages inbox reloads so the chat shows up there (Wyatt, 2026-11-01).
 */
export const INBOX_SYNC = "chat:inbox-changed";

export function announceInboxChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(INBOX_SYNC));
}

export function onInboxChange(fn) {
  window.addEventListener(INBOX_SYNC, fn);
  return () => window.removeEventListener(INBOX_SYNC, fn);
}
