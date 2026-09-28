/*
 * In-memory sliding-window guard on signed-out review submissions: 5 per hour
 * per client.
 *
 * The signed-in review path is capped per account (2 reviews) and costs the
 * submitter a verified school login. A QR scan has neither, so this is the only
 * thing standing between one bored person and a hundred reviews.
 *
 * Same shape and same caveat as lib/leaseCheck/rateLimit.js: on Vercel every
 * serverless instance keeps its own counter and cold starts reset them, so this
 * is a soft abuse guard rather than a guarantee. There is no Redis in this
 * project and this feature does not add one.
 */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const _hits = new Map(); // key -> number[] (timestamps)

/*
 * Identify the client. x-forwarded-for is set by Vercel's proxy and its FIRST
 * entry is the real client; later entries are proxies and a client-supplied
 * header can only prepend, never remove ours. Falls back to the email so a
 * missing header (local dev) still limits something.
 */
export function anonReviewRateKey(req, email) {
  const fwd = req?.headers?.get?.("x-forwarded-for") || "";
  const ip = fwd.split(",")[0].trim();
  return ip || String(email || "").toLowerCase() || "unknown";
}

export function anonReviewRateLimited(key) {
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
