/*
 * recordOutcome: the one server helper every outcome hook calls (PRD 7.3).
 *
 * Reads the marketing session cookie, snapshots the session's source onto the
 * outcome, and inserts it with a dedupe_key so retries and double clicks are
 * counted once. An outcome with no session (mobile app, expired cookie) is
 * still recorded, with its source taken from the account's signup_* columns,
 * or "app" when the account has none.
 *
 * Recording must NEVER fail the user's action: every error is logged and
 * swallowed, and the function always resolves.
 */
import supabase from "@/lib/supabase";
import { attributionEnabled, isUuid } from "./config";
import { OUTCOMES, buildDedupeKey, isOutcome } from "./outcomes";
import { attachUserToSession, loadLiveSession, readSessionCookie } from "./sessions";

const UNIQUE_VIOLATION = "23505";

// The role lives in roles (users.role_id), not on users itself.
async function accountAttribution(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("signup_source, signup_medium, signup_campaign, roles!role_id(name)")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, role: data.roles?.name ?? null } : null;
}

/**
 * @param {Request|null} req  the incoming request (null: read cookies() from
 *   the current request scope)
 * @param {object} o
 * @param {string} o.outcome  canonical outcome name
 * @param {string} [o.userId]
 * @param {string} [o.userRole]  skip the users lookup when already known
 * @param {string} [o.subjectId]  listing, review, tour request, application or lease check id
 * @param {string} [o.sessionId]  use this session instead of the cookie's
 * @param {boolean} [o.useCookie=true]  false: never read the request cookie
 *   (outcomes recorded on someone else's behalf, e.g. an admin invite)
 * @returns {Promise<{recorded: boolean, reason?: string}>}
 */
export async function recordOutcome(req, { outcome, userId = null, userRole = null, subjectId = null, sessionId = null, useCookie = true } = {}) {
  try {
    if (!attributionEnabled()) return { recorded: false, reason: "disabled" };
    if (!isOutcome(outcome)) {
      console.error(`marketing: unknown outcome "${outcome}"`);
      return { recorded: false, reason: "unknown_outcome" };
    }
    const uid = isUuid(userId) ? userId : null;
    const subject = isUuid(subjectId) ? subjectId : null;

    let session = null;
    const sid = sessionId || (useCookie ? await readSessionCookie(req) : null);
    if (sid) session = await loadLiveSession(sid);

    let role = userRole;
    let account = null;
    if (uid && (!role || !session)) {
      account = await accountAttribution(uid);
      role = role || account?.role || null;
    }

    const attribution = session
      ? { source: session.source, medium: session.medium, campaign: session.campaign, link_id: session.link_id }
      : account?.signup_source
        ? { source: account.signup_source, medium: account.signup_medium, campaign: account.signup_campaign, link_id: null }
        : { source: "app", medium: "app", campaign: null, link_id: null };

    const dedupeKey = buildDedupeKey(outcome, { sessionId: session?.id, userId: uid, subjectId: subject });
    if (!dedupeKey) return { recorded: false, reason: "missing_id" };

    const { error } = await supabase.from("marketing_outcomes").insert({
      session_id: session?.id ?? null,
      user_id: uid,
      outcome,
      user_role: role,
      ...attribution,
      subject_id: subject,
      dedupe_key: dedupeKey,
    });

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        // Repeat page views are expected browsing, not a retry or double
        // click, so only action outcomes feed the "duplicates rejected" count.
        if (OUTCOMES[outcome].scope !== "session") {
          await supabase.from("marketing_outcome_rejections").insert({ outcome });
        }
        return { recorded: false, reason: "duplicate" };
      }
      throw error;
    }

    // Not for an outcome credited to an older session (application_submitted):
    // that session is over, and it already has its user.
    if (session && uid && !session.user_id && !sessionId) await attachUserToSession(session.id, uid);
    return { recorded: true };
  } catch (err) {
    console.error(`marketing: recordOutcome(${outcome}) failed:`, err?.message || err);
    return { recorded: false, reason: "error" };
  }
}
