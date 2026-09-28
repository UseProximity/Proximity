/*
 * In-memory sliding-window guard on signed-out address lookups: 60 per minute per
 * client.
 *
 * /api/properties/lookup is open to visitors so they can get all the way through
 * Add Listing before being asked for an account. Each call is a database read,
 * and typing an address fires one per chosen suggestion, so a real person stays
 * far below this; it only exists so a script cannot use the endpoint to walk the
 * whole property table.
 *
 * Same shape and same caveat as lib/reviews/rateLimit.js: every serverless
 * instance keeps its own counter and cold starts reset it, so this is a soft
 * abuse guard rather than a guarantee.
 */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;
const _hits = new Map(); // ip -> number[] (timestamps)

/*
 * x-forwarded-for is set by Vercel's proxy and its FIRST entry is the real
 * client; a client-supplied header can only prepend, never remove ours. Local
 * dev has no header, so everything shares one bucket there.
 */
export function lookupClientKey(req) {
  const fwd = req?.headers?.get?.("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || "unknown";
}

export function lookupRateLimited(key) {
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
