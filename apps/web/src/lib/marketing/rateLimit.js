/*
 * In-memory sliding-window limit on the session beacon, per client IP.
 *
 * A real visitor sends one beacon per route change, so 120 per 10 minutes is
 * far above normal browsing and only stops a script hammering the endpoint.
 * Same caveat as lib/reviews/rateLimit.js: each serverless instance keeps its
 * own counter and cold starts reset it, so this is a soft abuse guard. The IP
 * is only a Map key in memory; it is never written to the database.
 */
export const BEACON_LIMIT = 120;
export const BEACON_WINDOW_MS = 10 * 60 * 1000;
const MAX_KEYS = 5000;
const _hits = new Map(); // ip -> number[] (timestamps)

export function beaconRateLimited(key, now = Date.now()) {
  const k = key || "unknown";
  const recent = (_hits.get(k) || []).filter((t) => now - t < BEACON_WINDOW_MS);
  if (recent.length >= BEACON_LIMIT) {
    _hits.set(k, recent);
    return true;
  }
  recent.push(now);
  _hits.set(k, recent);
  if (_hits.size > MAX_KEYS) {
    // Drop the oldest entries so a flood of distinct IPs cannot grow memory.
    for (const old of _hits.keys()) {
      _hits.delete(old);
      if (_hits.size <= MAX_KEYS / 2) break;
    }
  }
  return false;
}

export function _resetBeaconRateLimit() {
  _hits.clear();
}
