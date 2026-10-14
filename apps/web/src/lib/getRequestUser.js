import { auth } from "@/auth";
import { authMobile } from "@/lib/authMobile";
import supabase from "@/lib/supabase";

/**
 * Thrown when the user lookup itself fails (the database or network, not a missing
 * account). Callers must not treat it as "not signed in": a 401 tells the mobile app
 * its session is dead and signs the user out, so a failed lookup has to surface as a
 * 5xx instead. Routes already catch and answer 500; the message is generic on
 * purpose, as some routes echo it.
 */
export class RequestUserLookupError extends Error {
  constructor(cause) {
    super("Could not verify the signed-in user.");
    this.name = "RequestUserLookupError";
    this.cause = cause;
  }
}

/**
 * Resolves the current request's user via the NextAuth session (web) first,
 * falling back to a mobile Bearer token. Always returns { id, email, role }
 * (or null) regardless of which auth path matched, so callers don't need to
 * special-case web vs mobile. `role` comes for free on both paths — the
 * session already carries it (auth.js's JWT callback) and so does the mobile
 * JWT payload (authMobile.js's buildUserPayload) — no extra DB lookup.
 */
export async function getRequestUser(req) {
  const session = await auth();
  if (session?.user?.id) {
    return { id: session.user.id, email: session.user.email ?? null, role: session.user.role ?? null };
  }

  const mobileAuth = await authMobile(req);
  if (!mobileAuth?.user?.id) return null;

  // A deleted account must stop authenticating immediately, not whenever its
  // 15-minute access token happens to expire. This branch already pays for a
  // row lookup, so the check is free here; the web branch above is gated in
  // auth.js's JWT callback instead (see its deleted_at handling) to keep the
  // session path zero-DB.
  // maybeSingle: no matching row is a null result, not an error, so a failed query
  // can be told apart from an account that is missing or deleted.
  const { data, error } = await supabase
    .from("users")
    .select("email, deleted_at")
    .eq("id", mobileAuth.user.id)
    .maybeSingle();
  if (error) {
    console.error("getRequestUser: user lookup failed:", error);
    throw new RequestUserLookupError(error);
  }
  if (!data || data.deleted_at) return null;

  return { id: mobileAuth.user.id, email: data.email ?? null, role: mobileAuth.user.role ?? null };
}
