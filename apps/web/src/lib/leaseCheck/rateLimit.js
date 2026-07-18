/*
 * In-memory sliding-window rate limit for lease checks: max 5 per hour per user.
 *
 * On Vercel each serverless instance keeps its own counter and they reset on cold
 * starts, so this is a soft abuse guard, not a hard guarantee — enough to stop a
 * single client hammering the (expensive) analysis path. There is no Redis in this
 * project and this feature does not add one.
 */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const _hits = new Map(); // userId -> number[] (timestamps)

export function leaseCheckRateLimited(userId) {
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
