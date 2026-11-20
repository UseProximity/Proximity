/*
 * In-memory sliding-window limits on the session beacon.
 *
 * Students on campus Wi-Fi can share one public IP, so a per-IP limit alone
 * would throttle exactly the flyer and QR traffic this exists to measure.
 * Three counters instead:
 *   - per session (the prx_msid cookie): 120 per 10 minutes. A real visitor
 *     sends one beacon per route change plus a keep-alive every 10 minutes.
 *   - per IP, requests with no session cookie (first beacons, bots): 600.
 *   - per IP, every request: 3000, a backstop so a script cannot dodge the
 *     limits by inventing a new cookie value on every call.
 *
 * Same caveat as lib/reviews/rateLimit.js: each serverless instance keeps its
 * own counters and cold starts reset them, so this is a soft abuse guard. The
 * IP is only a Map key in memory; it is never written to the database.
 */
export const BEACON_WINDOW_MS = 10 * 60 * 1000;
export const SESSION_LIMIT = 120;
export const NO_COOKIE_IP_LIMIT = 600;
export const IP_BACKSTOP_LIMIT = 3000;
/** Kept for callers and tests that use the per-key default. */
export const BEACON_LIMIT = SESSION_LIMIT;
const MAX_KEYS = 20000;
const _hits = new Map(); // key -> number[] (timestamps)

/** Count one hit on `key`; true when it is over `limit` in the window. */
export function beaconRateLimited(key, now = Date.now(), limit = BEACON_LIMIT) {
  const k = key || "unknown";
  const recent = (_hits.get(k) || []).filter((t) => now - t < BEACON_WINDOW_MS);
  if (recent.length >= limit) {
    _hits.set(k, recent);
    return true;
  }
  recent.push(now);
  _hits.set(k, recent);
  if (_hits.size > MAX_KEYS) {
    // Drop the oldest entries so a flood of distinct keys cannot grow memory.
    for (const old of _hits.keys()) {
      _hits.delete(old);
      if (_hits.size <= MAX_KEYS / 2) break;
    }
  }
  return false;
}

/**
 * The beacon's check: by session when the request carries one, by IP when it
 * does not, plus the IP backstop on every request.
 */
export function beaconRequestLimited({ ip, sessionId }, now = Date.now()) {
  const ipKey = ip || "unknown";
  if (beaconRateLimited(`all:${ipKey}`, now, IP_BACKSTOP_LIMIT)) return true;
  return sessionId
    ? beaconRateLimited(`s:${sessionId}`, now, SESSION_LIMIT)
    : beaconRateLimited(`ip:${ipKey}`, now, NO_COOKIE_IP_LIMIT);
}

export function _resetBeaconRateLimit() {
  _hits.clear();
}
