/*
 * In-memory sliding-window rate limit for listing drafts: max 20 per hour per
 * user — high enough for a landlord importing a whole multi-property site
 * (each property is one extraction), low enough to cap abuse at pocket change.
 * Same tradeoffs as lib/leaseCheck/rateLimit.js — per-instance, resets on cold
 * start; a soft abuse guard for an expensive path, not a hard guarantee.
 */
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function slidingWindow(limit) {
  const hits = new Map(); // userId -> number[] (timestamps)
  return (userId) => {
    const now = Date.now();
    const recent = (hits.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= limit) {
      hits.set(userId, recent);
      return true;
    }
    recent.push(now);
    hits.set(userId, recent);
    return false;
  };
}

/** Extractions (the Claude spend): counted only once a page actually yielded text. */
export const listingDraftRateLimited = slidingWindow(20);

/*
 * Every request, counted before any fetching or parsing. The extraction limit
 * above deliberately skips failed fetches, which also meant a request that
 * spent its whole time budget fetching and parsing a hostile page never counted
 * at all. Three times the extraction budget leaves room for retries.
 */
export const listingDraftRequestRateLimited = slidingWindow(60);
