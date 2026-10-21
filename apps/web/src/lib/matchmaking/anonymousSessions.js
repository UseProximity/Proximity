/*
 * Matchmaking before login. Everything the chat route needs to run the Proxy
 * chat for a visitor who has no account yet (Wyatt, 2026-10-20):
 *
 *   - identity: the prx_vid device cookie (lib/visitorCookie, shared with the
 *     waitlist feature);
 *   - the cap: three chats per device, counted on every session ever created
 *     for that cookie (claimed ones included: signing up does not refill it);
 *   - a soft per-IP limit so a script that clears its cookie cannot run up the
 *     ranking bill, sized for a campus network where many students share an IP;
 *   - the lock: a visitor gets to the end of the flow, but no response ever
 *     carries a listing id (picks, or the narrowing state that names the pool)
 *     until the session is claimed by an account;
 *   - the claim: only on the account's say-so. Coming back from the sign-up wall
 *     claims straight away; any other sign-in on that browser is asked first, so
 *     a shared computer never hands one person's chat to the next.
 *
 * Server-only: imports supabase and the ranker.
 */
import supabase from "@/lib/supabase";
import { computeRecommendations } from "@/lib/matchmaking/chatOrchestrator";

export { VISITOR_COOKIE, readVisitorId, newVisitorId, setVisitorCookie } from "@/lib/visitorCookie";

// Three free chats per device. "Start over" counts; resuming does not.
export const ANON_SESSION_CAP = 3;

// Unclaimed sessions older than this are blanked by the purge-accounts cron.
export const ANON_RETENTION_DAYS = 30;

const T = "matchmaking_chat_sessions";

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

/*
 * Unclaimed sessions past the claim window are blanked, not deleted: the row
 * keeps its id, created_at and status so the dashboard's signed-out counts and
 * conversion rate stay true for any period, but loses everything the visitor
 * said and the cookie that tied it to a browser. With visitor_id gone it no
 * longer counts toward that device's chat cap either, the same as a deletion.
 */
export async function expireAnonymousSessions() {
  const cutoff = new Date(Date.now() - ANON_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(T)
    .update({
      visitor_id: null,
      expired_at: new Date().toISOString(),
      preferences: {},
      weights: {},
      transcript: [],
      candidates: [],
      recommendations: [],
    })
    .is("user_id", null)
    .not("visitor_id", "is", null)
    .lt("created_at", cutoff)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// The chats this browser started signed out that no account owns yet, for the
// "add this chat to your account?" prompt: how many, and when the newest began
// (the client remembers a "Not mine" against that, so a later chat asks again).
// Abandoned ones ("start over") are not worth asking about.
export async function countClaimableSessions(visitorId) {
  if (!visitorId) return { count: 0, latestAt: null };
  const { data, count } = await supabase
    .from(T)
    .select("created_at", { count: "exact" })
    .eq("visitor_id", visitorId)
    .is("user_id", null)
    .not("status", "eq", "abandoned")
    .order("created_at", { ascending: false })
    .limit(1);
  return { count: count ?? 0, latestAt: data?.[0]?.created_at ?? null };
}

/*
 * Claim: stamp the signed-in account onto every session this device started
 * while signed out. Called only when the account asked for it (the chat route's
 * "claim" action), never as a side effect of an ordinary request.
 *
 * On claim the session also learns what the account knows: the first name (the
 * chat no longer asks for it) and the recorded gender. A finished chat was
 * ranked without a gender, which keeps gender-restricted listings OUT of the
 * picks (an unknown viewer never qualifies, see listingConstraints). When the
 * account has one recorded, the three picks are recomputed once so listings
 * this student does qualify for can come back in. Nothing was shown yet, so
 * there is no "my matches changed" surprise.
 */
//
// Returns how many were claimed and the newest live one, which the client opens.
export async function claimVisitorSessions(actor, visitorId) {
  const none = { claimed: 0, sessionId: null };
  if (!visitorId || !actor?.id) return none;
  const { data: rows } = await supabase
    .from(T)
    .select("id, status, created_at, preferences, weights, transcript")
    .eq("visitor_id", visitorId)
    .is("user_id", null)
    .order("created_at", { ascending: false });
  if (!rows?.length) return none;

  const firstName = (actor.name ?? "").trim().split(/\s+/)[0] ?? "";
  const gender = normalizeAccountGender(actor.gender);

  // Each row re-ranks and claims on its own, side by side: one failing leaves
  // the others claimed, and the claim call can simply be retried.
  const results = await Promise.all(
    rows.map(async (row) => {
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

      // `.is("user_id", null)` again so two concurrent claims (two tabs) cannot
      // both claim, and a row some other account claimed meanwhile is skipped.
      const { data: updated } = await supabase.from(T).update(patch).eq("id", row.id).is("user_id", null).select("id");
      return updated?.length ? row : null;
    })
  );
  const claimed = results.filter(Boolean);
  // Rows came newest first, and Promise.all keeps that order.
  const open = claimed.find((r) => r.status !== "abandoned");
  return { claimed: claimed.length, sessionId: open?.id ?? null };
}

function normalizeAccountGender(g) {
  const v = String(g ?? "").trim().toLowerCase();
  return !v || v === "unspecified" ? null : v;
}

// The "here are your matches" message embeds its own copy of the picks, and a
// reload renders the cards from it: rewrite the latest one to the fresh set.
export function withLatestRecommendations(transcript, recommendations) {
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
// Nothing a visitor's browser receives may name a listing: the listing endpoint
// is public, so an id IS the match. That holds for the whole chat, not just the
// end. Mid-chat, the narrowing state (each tradeoff's kept and dropped listings,
// the pruned and set-aside sets) names the shrinking pool, which after the last
// tradeoff is a superset of the picks. Once the picks exist, only each card's
// intention label survives ("Best value", "Closest to campus"), enough to draw
// the three placeholder cards behind the sign-up wall.
//
// The server never needs these back from the client: handleTurn carries them
// over from the stored session, and a visitor's rewind restores them with
// withHiddenPreferences.

const HIDDEN_PREF_KEYS = [
  "_setAside",
  "_excluded",
  "_narrowed",
  "_autoPruned",
  "_shadowOptIn",
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
  if (!preferences) return preferences;
  const out = { ...preferences };
  for (const k of HIDDEN_PREF_KEYS) delete out[k];
  // The client only reads how MANY tradeoffs were answered (it stamps each
  // answer bubble with its index for "Edit"), so placeholders keep the count.
  if (Array.isArray(preferences._tradeoffHistory)) out._tradeoffHistory = preferences._tradeoffHistory.map(() => null);
  return out;
}

function lockTranscript(transcript) {
  return (Array.isArray(transcript) ? transcript : []).map((m) =>
    Array.isArray(m?.recommendations) && m.recommendations.length
      ? { ...m, recommendations: lockRecommendations(m.recommendations), locked: true }
      : m
  );
}

// A visitor's preferences as the client sent them, with the hidden keys put
// back from the stored copy (the client only ever held the stripped version).
export function withHiddenPreferences(clientPrefs, storedPrefs) {
  const out = { ...(clientPrefs ?? {}) };
  for (const k of HIDDEN_PREF_KEYS) {
    if (storedPrefs?.[k] !== undefined) out[k] = storedPrefs[k];
    else delete out[k];
  }
  return out;
}

// A whole stored session, as returned by GET.
export function lockSessionForVisitor(session) {
  if (!session) return null;
  // The candidate pool column is never needed client-side, and the cookie value
  // stays out of reach of page scripts (it is HttpOnly for a reason).
  const { candidates, visitor_id, ...rest } = session;
  return {
    ...rest,
    preferences: lockPreferences(rest.preferences),
    recommendations: lockRecommendations(rest.recommendations),
    transcript: lockTranscript(rest.transcript),
    locked: isLockedStatus(session.status),
  };
}

// One turn's response payload, as returned by POST / PATCH.
export function lockTurnForVisitor(payload) {
  if (!payload) return payload;
  return {
    ...payload,
    preferences: lockPreferences(payload.preferences),
    ...("recommendations" in payload ? { recommendations: lockRecommendations(payload.recommendations) } : {}),
    draft: null,
    locked: isLockedStatus(payload.status),
  };
}
