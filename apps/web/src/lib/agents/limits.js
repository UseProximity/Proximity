/*
 * Rate limits for Proxy, separate from the chat send limits (which never
 * count Proxy's own messages).
 *
 *   signed in     messages per account per day
 *   signed out    messages per device per day; listings per device (the
 *                 matchmaking cap, three); questions sent to landlords per
 *                 device per day (Wyatt, 2026-10-26: three); and a soft
 *                 per-IP ceiling kept in memory, sized for a campus network
 *                 where a dorm can share one address.
 *
 * Counts come from the audit log (listing_agent_questions) and the threads
 * table, so they hold across server instances. Every number can be changed
 * with a PROXY_* setting. Test mode (a landlord trying their own listing) is
 * never limited.
 */
import supabase from "@/lib/supabase";
import { proxyThreadTypeId } from "./threads";

const n = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
export const LIMITS = {
  userPerDay: n("PROXY_USER_MESSAGES_PER_DAY", 80),
  visitorPerDay: n("PROXY_VISITOR_MESSAGES_PER_DAY", 30),
  visitorListings: n("PROXY_VISITOR_LISTINGS", 3),
  visitorQuestionsPerDay: n("PROXY_VISITOR_QUESTIONS_PER_DAY", 3),
  ipPerHour: n("PROXY_IP_PER_HOUR", 120),
};

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const since = (ms) => new Date(Date.now() - ms).toISOString();

export const PROXY_LIMIT_MESSAGE = "You've reached today's limit for questions. Please try again tomorrow.";
export const PROXY_VISITOR_LISTINGS_MESSAGE = "Sign in to ask about more places. Signed-out visitors can ask about three listings.";

const ipHits = () => (globalThis.__prxProxyHits ??= new Map());
export function ipLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const map = ipHits();
  const recent = (map.get(ip) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= LIMITS.ipPerHour) { map.set(ip, recent); return true; }
  recent.push(now);
  map.set(ip, recent);
  if (map.size > 10000) map.delete(map.keys().next().value);
  return false;
}

async function countLog(filter, ms) {
  let q = supabase.from("listing_agent_questions").select("id", { count: "exact", head: true }).gt("created_at", since(ms));
  q = filter(q);
  const { count, error } = await q;
  if (error) throw new Error(`proxy limits: ${error.message}`);
  return count ?? 0;
}

/* Before a student message is handled. Returns null when fine, else a refusal. */
export async function checkMessageAllowed({ userId = null, visitorId = null, ip = null, listingId }) {
  if (userId) {
    const used = await countLog((q) => q.eq("user_id", userId), DAY);
    if (used >= LIMITS.userPerDay) return { status: 429, error: PROXY_LIMIT_MESSAGE };
    return null;
  }
  if (!visitorId) return { status: 401, error: "Sign in to ask about this place." };
  if (ipLimited(ip)) return { status: 429, error: PROXY_LIMIT_MESSAGE };
  const used = await countLog((q) => q.eq("visitor_id", visitorId), DAY);
  if (used >= LIMITS.visitorPerDay) return { status: 429, error: PROXY_LIMIT_MESSAGE };
  // Three listings per device, counted on every thread the cookie ever opened.
  const typeId = await proxyThreadTypeId();
  const { data } = await supabase.from("chat_threads").select("listing_id")
    .eq("thread_type_id", typeId).eq("visitor_id", visitorId).limit(50);
  const listings = new Set((data ?? []).map((t) => t.listing_id));
  if (!listings.has(listingId) && listings.size >= LIMITS.visitorListings) {
    return { status: 403, error: PROXY_VISITOR_LISTINGS_MESSAGE, code: "SIGN_IN" };
  }
  return null;
}

/* Before a signed-out visitor's question is sent to a landlord. */
export async function visitorCanAskLandlord(visitorId) {
  if (!visitorId) return false;
  const used = await countLog((q) => q.eq("visitor_id", visitorId).eq("outcome", "asked_landlord"), DAY);
  return used < LIMITS.visitorQuestionsPerDay;
}
