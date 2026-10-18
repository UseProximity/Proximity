/*
 * In-memory brute-force guard for the two password login paths (the NextAuth
 * credentials provider and POST /api/auth/mobile/login).
 *
 * Failures are tracked twice: per email (stops guessing one account's password)
 * and per client IP (stops one source working through many accounts). Reaching a
 * threshold inside the window locks that key for LOCK_MS. A locked key refuses
 * every attempt, right password included, until the lock expires.
 *
 * Thresholds: 5 failures per email in 15 minutes is generous for a real person
 * and caps an attacker at a few hundred guesses per account per day. The IP limit
 * is 20 because many students share one campus network.
 *
 * Callers must run checkLoginLock() BEFORE any database lookup, so a locked
 * unknown email and a locked real email get the same response, and the check is
 * cheap. Failures that are indistinguishable to the caller (unknown email, deleted
 * account, wrong password) must all be recorded, so lockout never reveals which
 * emails exist.
 *
 * A successful login clears the email counter only. Clearing the IP counter too
 * would let an attacker reset it by logging into their own account between guesses.
 *
 * Same caveat as lib/leaseCheck/rateLimit.js: on Vercel every serverless instance
 * keeps its own counters and cold starts reset them, so this slows an attacker
 * down but is not a hard guarantee. There is no Redis in this project and this
 * feature does not add one.
 */
export const EMAIL_MAX_FAILURES = 5;
export const IP_MAX_FAILURES = 20;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
export const MAX_TRACKED_KEYS = 10_000;
const SWEEP_EVERY_MS = 60 * 1000;

/*
 * State lives on globalThis, not in module scope. Next compiles the NextAuth route
 * and the mobile login route as separate bundles, and each would otherwise get its
 * own copy of this module and its own counters, so an attacker could alternate
 * between the two paths for double the guesses. It also survives dev hot reloads.
 * key -> { fails: number[] (timestamps), lockedUntil: number }
 */
const _state = (globalThis.__loginThrottle ??= {
  byEmail: new Map(),
  byIp: new Map(),
  lastSweep: 0,
});
const _byEmail = _state.byEmail;
const _byIp = _state.byIp;

function emailKey(email) {
  return String(email || "").trim().toLowerCase();
}

/*
 * Identify the client. x-forwarded-for is set by Vercel's proxy and its FIRST
 * entry is the real client (same convention as lib/reviews/rateLimit.js). Returns
 * "" when there is no header (local dev), in which case the IP counter is skipped
 * rather than lumping every local request into one shared bucket.
 */
export function clientIp(headers) {
  const fwd = headers?.get?.("x-forwarded-for") || headers?.get?.("x-real-ip") || "";
  return fwd.split(",")[0].trim();
}

function isActive(entry, now) {
  return (
    entry.lockedUntil > now ||
    entry.fails.some((t) => now - t < FAILURE_WINDOW_MS)
  );
}

function sweep(map, now) {
  for (const [key, entry] of map) {
    if (!isActive(entry, now)) map.delete(key);
  }
}

// Evict oldest entries (Map keeps insertion order), unlocked ones first, so a
// flood of made-up emails cannot push real locks out of a full map.
function enforceCap(map, now) {
  if (map.size < MAX_TRACKED_KEYS) return;
  sweep(map, now);
  for (const [key, entry] of map) {
    if (map.size < MAX_TRACKED_KEYS) return;
    if (entry.lockedUntil <= now) map.delete(key);
  }
  for (const key of map.keys()) {
    if (map.size < MAX_TRACKED_KEYS) return;
    map.delete(key);
  }
}

function maybeSweep(now) {
  if (now - _state.lastSweep < SWEEP_EVERY_MS) return;
  _state.lastSweep = now;
  sweep(_byEmail, now);
  sweep(_byIp, now);
}

function remainingSec(entry, now) {
  return Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000));
}

/*
 * { locked: false } or { locked: true, retryAfterSec }. Never records anything,
 * so refused attempts do not extend a lock.
 */
export function checkLoginLock({ email, ip }, now = Date.now()) {
  maybeSweep(now);
  let retryAfterSec = 0;
  const byEmail = _byEmail.get(emailKey(email));
  if (byEmail && byEmail.lockedUntil > now) {
    retryAfterSec = Math.max(retryAfterSec, remainingSec(byEmail, now));
  }
  const byIp = ip ? _byIp.get(ip) : null;
  if (byIp && byIp.lockedUntil > now) {
    retryAfterSec = Math.max(retryAfterSec, remainingSec(byIp, now));
  }
  return retryAfterSec > 0 ? { locked: true, retryAfterSec } : { locked: false };
}

function addFailure(map, key, max, now) {
  let entry = map.get(key);
  if (!entry) {
    enforceCap(map, now);
    entry = { fails: [], lockedUntil: 0 };
    map.set(key, entry);
  }
  if (entry.lockedUntil > now) return;
  entry.fails = entry.fails.filter((t) => now - t < FAILURE_WINDOW_MS);
  entry.fails.push(now);
  if (entry.fails.length >= max) {
    entry.lockedUntil = now + LOCK_MS;
    entry.fails = []; // the counter starts fresh once the lock lapses
  }
}

export function recordLoginFailure({ email, ip }, now = Date.now()) {
  const key = emailKey(email);
  if (key) addFailure(_byEmail, key, EMAIL_MAX_FAILURES, now);
  if (ip) addFailure(_byIp, ip, IP_MAX_FAILURES, now);
}

export function recordLoginSuccess({ email }) {
  _byEmail.delete(emailKey(email));
}

// Test hook: wipe all state.
export function _resetLoginThrottle() {
  _byEmail.clear();
  _byIp.clear();
  _state.lastSweep = 0;
}

// Test hook: how many keys are currently tracked.
export function _trackedKeyCounts() {
  return { email: _byEmail.size, ip: _byIp.size };
}
