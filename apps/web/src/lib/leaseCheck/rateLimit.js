/*
 * In-memory sliding-window rate limit for lease checks: max 5 per hour per client.
 *
 * Keyed by "user:<id>" for signed-in requests and by IP for signed-out ones — the
 * presign step (POST /api/lease-check) now allows anonymous callers so the auth gate
 * can be shown only after the lease is already uploaded (see route.js), and this is
 * what stops that path from being hammered for free storage/bandwidth. Same
 * IP-extraction approach as lib/reviews/rateLimit.js.
 *
 * On Vercel each serverless instance keeps its own counter and they reset on cold
 * starts, so this is a soft abuse guard, not a hard guarantee — enough to stop a
 * single client hammering the (expensive) analysis path. There is no Redis in this
 * project and this feature does not add one.
 */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const _hits = new Map(); // key -> number[] (timestamps)

/*
 * Identify the client for rate-limiting. x-forwarded-for is set by Vercel's proxy
 * and its FIRST entry is the real client; later entries are proxies and a
 * client-supplied header can only prepend, never remove ours.
 */
export function leaseCheckRateKey(req, userId) {
  if (userId) return `user:${userId}`;
  const fwd = req?.headers?.get?.("x-forwarded-for") || "";
  const ip = fwd.split(",")[0].trim();
  return ip ? `ip:${ip}` : "unknown";
}

export function leaseCheckRateLimited(key) {
  const now = Date.now();
  const recent = (_hits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    _hits.set(key, recent);
    return true;
  }
  recent.push(now);
  _hits.set(key, recent);
  return false;
}
