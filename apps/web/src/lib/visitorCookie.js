/*
 * The prx_vid device cookie: names a signed-out browser across visits. Shared
 * by the waitlist (so repeat clicks from one person don't read as several) and
 * the signed-out matchmaking chat (whose sessions and three-chat cap are keyed
 * by it). One module so both features agree on the name, lifetime and format;
 * a mismatch would reset a device's identity, and with it the chat cap.
 *
 * HttpOnly and set by the server, so Safari does not expire it the way it does
 * script-set cookies. Cleared at sign-out (api/auth/[...nextauth]) so the next
 * person on a shared browser does not inherit it.
 */
import { randomUUID } from "crypto";

export const VISITOR_COOKIE = "prx_vid";

// A year outlives a leasing cycle, which is the window any of this gets
// reconciled over.
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The cookie's value, or null when it is missing or not one we minted.
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

// A Set-Cookie header value that deletes the cookie, for responses that are not
// NextResponses (the NextAuth handlers return plain Responses).
export const CLEAR_VISITOR_COOKIE = `${VISITOR_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
