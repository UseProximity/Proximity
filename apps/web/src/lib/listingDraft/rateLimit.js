/*
 * In-memory sliding-window rate limit for listing drafts: max 20 per hour per
 * user — high enough for a landlord importing a whole multi-property site
 * (each property is one extraction), low enough to cap abuse at pocket change.
 * Same tradeoffs as lib/leaseCheck/rateLimit.js — per-instance, resets on cold
 * start; a soft abuse guard for an expensive path, not a hard guarantee.
 */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const _hits = new Map(); // userId -> number[] (timestamps)

export function listingDraftRateLimited(userId) {
  const now = Date.now();
  const recent = (_hits.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    _hits.set(userId, recent);
    return true;
  }
  recent.push(now);
  _hits.set(userId, recent);
  return false;
}
