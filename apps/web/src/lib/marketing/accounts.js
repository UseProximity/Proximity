/*
 * Account outcomes (PRD 7.4, section 6 tier 1).
 *
 *   stampSignup     every account creation path calls this once the users row
 *                   exists: copies the visit's source onto the account, links
 *                   the session to the user, records account_created
 *   recordActivation  the account's first sign-in or first password set
 *   onSignIn        every sign-in: attach the user to the live session, then
 *                   recordActivation
 *
 * Like recordOutcome, none of these ever throw or fail the user's action.
 * Outside a request (cron, webhook) there is no session cookie, and the
 * account is stamped "unknown" or with its label.
 */
import supabase from "@/lib/supabase";
import { attributionEnabled, isUuid } from "./config";
import { recordOutcome } from "./record";
import { attachUserToSession, loadLiveSession, loadSessionById, readSessionCookie } from "./sessions";
import { shouldRecordActivation, signupColumns } from "./signup";

/**
 * @param {Request|null} req  null: read the cookie from the current request scope
 * @param {object} o
 * @param {string} o.userId  the account just created
 * @param {string} [o.role]  student, landlord or parent (looked up when omitted)
 * @param {"app"|"invite"} [o.label]  no visitor session: mobile ("app") or
 *   created on someone's behalf ("invite"). The request cookie is not read.
 * @param {string} [o.sessionId]  the visit the account was really started in,
 *   when it is only created later (a Proxy visitor's emailed confirmation
 *   link). Used whatever its age, instead of the request cookie.
 */
export async function stampSignup(req, { userId, role = null, label = null, sessionId = null } = {}) {
  try {
    if (!attributionEnabled() || !isUuid(userId)) return;

    let session = null;
    if (!label && sessionId) {
      session = await loadSessionById(sessionId);
    } else if (!label) {
      const sid = await readSessionCookie(req);
      if (sid) session = await loadLiveSession(sid);
    }

    // Only the first stamp counts: a path that runs twice never relabels.
    const { error } = await supabase
      .from("users")
      .update(signupColumns(session, label))
      .eq("id", userId)
      .is("signup_source", null);
    if (error) throw error;

    if (session) await attachUserToSession(session.id, userId);

    await recordOutcome(req, {
      outcome: "account_created",
      userId,
      userRole: role,
      // An earlier visit has usually gone idle by now, so it is credited
      // directly rather than looked up as a live session.
      ...(sessionId && session ? { creditSessionId: session.id } : { sessionId: session?.id ?? null }),
      useCookie: false,
    });
  } catch (err) {
    console.error("marketing: stampSignup failed:", err?.message || err);
  }
}

/**
 * Records account_activated the first time a newly created account signs in
 * or sets a password. useCookie false for mobile (no browser session).
 */
export async function recordActivation(req, { userId, role = null, useCookie = true } = {}) {
  try {
    if (!attributionEnabled() || !isUuid(userId)) return;
    const { data, error } = await supabase
      .from("marketing_outcomes")
      .select("outcome")
      .eq("user_id", userId)
      .in("outcome", ["account_created", "account_activated"]);
    if (error) throw error;
    if (!shouldRecordActivation((data || []).map((r) => r.outcome))) return;
    await recordOutcome(req, { outcome: "account_activated", userId, userRole: role, useCookie });
  } catch (err) {
    console.error("marketing: recordActivation failed:", err?.message || err);
  }
}

/** Every web sign-in: the live session learns who it is, then activation. */
export async function onSignIn(req, { userId, role = null } = {}) {
  try {
    if (!attributionEnabled() || !isUuid(userId)) return;
    const sid = await readSessionCookie(req);
    if (sid) await attachUserToSession(sid, userId);
    await recordActivation(req, { userId, role });
  } catch (err) {
    console.error("marketing: onSignIn failed:", err?.message || err);
  }
}
