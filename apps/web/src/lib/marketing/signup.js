/*
 * The source stamped on a new account (PRD 7.4): users.signup_session_id,
 * signup_source, signup_medium and signup_campaign. referral_source is never
 * touched; it stays the self-reported answer.
 *
 *   label    a path with no visitor session of its own: "app" (mobile signup)
 *            or "invite" (an account someone else created by inviting them)
 *   session  the visitor's live marketing session: its source wins
 *   neither  a web signup with no live session (attribution cookie missing
 *            or expired), stamped "unknown" so it shows up in Data quality
 *            instead of passing for direct traffic
 *
 * Pure; no "@/" imports (Node test runner loads it).
 */

export const SIGNUP_LABELS = new Set(["app", "invite"]);
export const UNKNOWN_SOURCE = "unknown";

export function signupColumns(session, label = null) {
  if (label && SIGNUP_LABELS.has(label)) {
    return { signup_session_id: null, signup_source: label, signup_medium: label, signup_campaign: null };
  }
  if (session?.id) {
    return {
      signup_session_id: session.id,
      signup_source: session.source || UNKNOWN_SOURCE,
      signup_medium: session.medium || UNKNOWN_SOURCE,
      signup_campaign: session.campaign ?? null,
    };
  }
  return { signup_session_id: null, signup_source: UNKNOWN_SOURCE, signup_medium: UNKNOWN_SOURCE, signup_campaign: null };
}

/*
 * Whether a request on a route shared by web and mobile (POST /api/auth/signup)
 * came from the app. Browsers send Origin (and Sec-Fetch-Site) on every POST;
 * the React Native client sends neither and has no other marker. Sec-Fetch-Mode
 * is not used: Node's fetch adds it too. Anything that is not a browser is
 * therefore labelled "app" rather than "unknown".
 */
export function looksLikeAppRequest(headers) {
  const get = (name) => headers?.get?.(name) ?? null;
  return !get("origin") && !get("sec-fetch-site");
}

/*
 * account_activated is recorded once, and only for an account whose creation
 * was recorded (created on or after launch). Without that check every account
 * made before launch would count as "activated" on its next sign-in, which is
 * not a first sign-in at all.
 */
export function shouldRecordActivation(outcomeNames) {
  const have = new Set(outcomeNames || []);
  return have.has("account_created") && !have.has("account_activated");
}
