/*
 * In-memory sliding-window rate limit for listing drafts: max 5 per hour per
 * user. Same tradeoffs as lib/leaseCheck/rateLimit.js — per-instance, resets on
 * cold start; a soft abuse guard for an expensive path, not a hard guarantee.
 */
const RATE_LIMIT = 5;
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
