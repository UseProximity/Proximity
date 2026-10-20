/*
 * Matchmaking before login. Everything the chat route needs to run the Proxy
 * chat for a visitor who has no account yet (Wyatt, 2026-10-20):
 *
 *   - identity: the prx_vid device cookie (same cookie the waitlist feature
 *     sets), HttpOnly and set by the server, so Safari does not expire it the way
 *     it does script-set cookies;
 *   - the cap: three chats per device, counted on every session ever created
 *     for that cookie (claimed ones included: signing up does not refill it);
 *   - a soft per-IP limit so a script that clears its cookie cannot run up the
 *     ranking bill, sized for a campus network where many students share an IP;
 *   - the lock: a visitor gets to the end of the flow, but the response never
 *     carries which listings matched until the session is claimed by an account;
 *   - the claim: the first signed-in request from that device takes ownership of
 *     every unclaimed session for the cookie.
 *
 * Server-only: imports supabase and the ranker.
 */
import { randomUUID } from "crypto";
import supabase from "@/lib/supabase";
import { computeRecommendations } from "@/lib/matchmaking/chatOrchestrator";

export const VISITOR_COOKIE = "prx_vid";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Three free chats per device. "Start over" counts; resuming does not.
export const ANON_SESSION_CAP = 3;

// Unclaimed sessions older than this are deleted by the purge-accounts cron.
export const ANON_RETENTION_DAYS = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const T = "matchmaking_chat_sessions";

// ── Device cookie ───────────────────────────────────────────────────────────

export function readVisitorId(request) {
  const v = request?.cookies?.get?.(VISITOR_COOKIE)?.value ?? "";
  return UUID_RE.test(v) ? v.toLowerCase() : null;
}

export function newVisitorId() {
  return randomUUID();
}

export function setVisitorCookie(response, visitorId) {
  response.cookies.set(VISITOR_COOKIE, visitorId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE,
  });
  return response;
}

// ── Soft per-IP limit ───────────────────────────────────────────────────────
//
// Sliding window, in memory, on globalThis so dev hot reloads and separately
// bundled routes share one counter. Same caveat as lib/auth/loginThrottle.js: on
// Vercel each instance keeps its own counter and cold starts reset it, so this
// slows abuse down rather than guaranteeing a ceiling. 60 an hour is generous
// for WashU's network, where a whole dorm can sit behind one address.
export const ANON_IP_LIMIT = 60;
const ANON_IP_WINDOW_MS = 60 * 60 * 1000;
const MAX_TRACKED_IPS = 10_000;

function ipHits() {
  if (!globalThis.__prxAnonChatHits) globalThis.__prxAnonChatHits = new Map();
  return globalThis.__prxAnonChatHits;
}

// Records a chat start for this IP and reports whether it was over the limit.
export function anonIpLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const map = ipHits();
  const recent = (map.get(ip) ?? []).filter((t) => now - t < ANON_IP_WINDOW_MS);
  if (recent.length >= ANON_IP_LIMIT) {
    map.set(ip, recent);
    return true;
  }
  recent.push(now);
  map.set(ip, recent);
  if (map.size > MAX_TRACKED_IPS) {
    for (const [key, hits] of map) {
      if (!hits.some((t) => now - t < ANON_IP_WINDOW_MS)) map.delete(key);
      if (map.size <= MAX_TRACKED_IPS) break;
    }
  }
  return false;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function countVisitorSessions(visitorId) {
  const { count } = await supabase
    .from(T)
    .select("id", { count: "exact", head: true })
    .eq("visitor_id", visitorId);
  return count ?? 0;
}

export async function triesLeftFor(visitorId) {
  if (!visitorId) return ANON_SESSION_CAP;
  return Math.max(0, ANON_SESSION_CAP - (await countVisitorSessions(visitorId)));
}

// A visitor may only ever see sessions that are still theirs: created from this
// cookie and not yet claimed by an account. Once claimed, the row belongs to the
// account, even on the device that started it.
export async function visitorSessionById(visitorId, sessionId) {
  const { data } = await supabase
    .from(T)
    .select("*")
    .eq("id", sessionId)
    .eq("visitor_id", visitorId)
    .is("user_id", null)
    .not("status", "eq", "abandoned")
    .maybeSingle();
  return data ?? null;
}

export async function latestVisitorSession(visitorId) {
  const { data } = await supabase
    .from(T)
    .select("*")
    .eq("visitor_id", visitorId)
    .is("user_id", null)
    .not("status", "eq", "abandoned")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export function ownsAsVisitor(session, visitorId) {
  return !!visitorId && session?.user_id == null && session?.visitor_id === visitorId;
}

// ── Writes ──────────────────────────────────────────────────────────────────

// "Start over" leaves exactly one live chat per device: the one being created.
export async function abandonUnfinishedVisitorSessions(visitorId) {
  await supabase
    .from(T)
    .update({ status: "abandoned" })
    .eq("visitor_id", visitorId)
    .is("user_id", null)
    .eq("status", "in_progress");
}

export async function deleteExpiredAnonymousSessions() {
  const cutoff = new Date(Date.now() - ANON_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(T)
    .delete()
    .is("user_id", null)
    .lt("created_at", cutoff)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/*
 * Claim: stamp the signed-in account onto every session this device started
 * while signed out. Runs on each signed-in request that carries the cookie; it
 * is a no-op once nothing is left to claim.
 *
 * On claim the session also learns what the account knows: the first name (the
 * chat no longer asks for it) and the recorded gender. A finished chat was
 * ranked without a gender, which keeps gender-restricted listings OUT of the
 * picks (an unknown viewer never qualifies, see listingConstraints). When the
 * account has one recorded, the three picks are recomputed once so listings
 * this student does qualify for can come back in. Nothing was shown yet, so
 * there is no "my matches changed" surprise.
 */
export async function claimVisitorSessions(actor, visitorId) {
  if (!visitorId || !actor?.id) return 0;
  const { data: rows } = await supabase
    .from(T)
    .select("id, status, preferences, weights, transcript")
    .eq("visitor_id", visitorId)
    .is("user_id", null);
  if (!rows?.length) return 0;

  const firstName = (actor.name ?? "").trim().split(/\s+/)[0] ?? "";
  const gender = normalizeAccountGender(actor.gender);

  let claimed = 0;
  for (const row of rows) {
    const preferences = { ...(row.preferences ?? {}), _viewerGender: gender };
    if (firstName && !preferences.name) preferences.name = firstName;

    const patch = { user_id: actor.id, preferences };
    if (row.status === "recommendations_ready" && gender) {
      try {
        const fresh = await computeRecommendations(preferences, row.weights ?? {});
        if (fresh.length) {
          patch.recommendations = fresh;
          patch.transcript = withLatestRecommendations(row.transcript, fresh);
        }
      } catch (err) {
        console.error("[matchmaking claim] re-rank failed, keeping anonymous picks:", err);
      }
    }

    // `.is("user_id", null)` again so two concurrent signed-in requests (two tabs)
    // cannot both claim, and a row some other account claimed meanwhile is skipped.
    const { data: updated } = await supabase.from(T).update(patch).eq("id", row.id).is("user_id", null).select("id");
    if (updated?.length) claimed += 1;
  }
  return claimed;
}

function normalizeAccountGender(g) {
  const v = String(g ?? "").trim().toLowerCase();
  return !v || v === "unspecified" ? null : v;
}

// The "here are your matches" message embeds its own copy of the picks, and a
// reload renders the cards from it: rewrite the latest one to the fresh set.
function withLatestRecommendations(transcript, recommendations) {
  if (!Array.isArray(transcript)) return transcript;
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (Array.isArray(transcript[i]?.recommendations) && transcript[i].recommendations.length) {
      return transcript.map((m, idx) => (idx === i ? { ...m, recommendations } : m));
    }
  }
  return transcript;
}

// ── The lock ────────────────────────────────────────────────────────────────
//
// A visitor's finished session goes to the browser without the picks: only each
// card's intention label survives ("Best value", "Closest to campus"), enough to
// draw the three placeholder cards behind the sign-up wall, and never a listing
// id or any card data (the listing endpoint is public, so an id IS the match).
// The hidden narrowing state is dropped too since it carries the candidate pool.

const LOCKED_PREF_KEYS = [
  "_setAside",
  "_excluded",
  "_narrowed",
  "_autoPruned",
  "_pendingTradeoff",
  "_tradeoffHistory",
  "_relaxPrevSetAside",
  "_usage",
];

export function isLockedStatus(status) {
  return status === "recommendations_ready";
}

function lockRecommendations(recs) {
  return (Array.isArray(recs) ? recs : []).map((r) => ({ intention: r?.intention ?? "Match" }));
}

function lockPreferences(preferences) {
  const out = { ...(preferences ?? {}) };
  for (const k of LOCKED_PREF_KEYS) delete out[k];
  return out;
}

function lockTranscript(transcript) {
  return (Array.isArray(transcript) ? transcript : []).map((m) =>
    Array.isArray(m?.recommendations) && m.recommendations.length
      ? { ...m, recommendations: lockRecommendations(m.recommendations), locked: true }
      : m
  );
}

// A whole stored session, as returned by GET.
export function lockSessionForVisitor(session) {
  if (!session) return null;
  // The candidate pool column is never needed client-side; `_pendingTradeoff`
  // names pool listings even before the picks exist.
  const { candidates, ...rest } = session;
  const prefs = { ...(rest.preferences ?? {}) };
  delete prefs._pendingTradeoff;
  if (!isLockedStatus(session.status)) return { ...rest, preferences: prefs, locked: false };
  return {
    ...rest,
    preferences: lockPreferences(prefs),
    recommendations: lockRecommendations(rest.recommendations),
    transcript: lockTranscript(rest.transcript),
    locked: true,
  };
}

// One turn's response payload, as returned by POST / PATCH.
export function lockTurnForVisitor(payload) {
  if (!payload) return payload;
  const prefs = payload.preferences ? { ...payload.preferences } : payload.preferences;
  if (prefs) delete prefs._pendingTradeoff;
  if (!isLockedStatus(payload.status)) return { ...payload, preferences: prefs, locked: false };
  return {
    ...payload,
    preferences: prefs ? lockPreferences(prefs) : prefs,
    recommendations: lockRecommendations(payload.recommendations),
    draft: null,
    locked: true,
  };
}
