/*
 * Navigate to /messages from anywhere (header badge, deep links). Soft-nav via
 * a router registered by Providers; falls back to location.assign.
 */

/** @type {((href: string) => void) | null} */
let navigateToMessages = null;

/**
 * Called once from Providers so openMessages can soft-navigate with the App Router.
 * @param {(href: string) => void} fn
 */
export function registerMessagesNavigate(fn) {
  navigateToMessages = typeof fn === "function" ? fn : null;
}

/**
 * @param {{ threadId?: string }} [detail]
 * @returns {string}
 */
export function messagesHref(detail = {}) {
  const threadId =
    typeof detail?.threadId === "string" ? detail.threadId.trim() : "";
  if (threadId) {
    return `/messages?thread=${encodeURIComponent(threadId)}`;
  }
  return "/messages";
}

/**
 * @param {{ threadId?: string }} [detail]
 */
export function openMessages(detail = {}) {
  if (typeof window === "undefined") return;
  const href = messagesHref(detail);
  if (navigateToMessages) {
    navigateToMessages(href);
    return;
  }
  window.location.assign(href);
}
