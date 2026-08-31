import { auth } from "@/auth";
import { authMobile } from "@/lib/authMobile";
import supabase from "@/lib/supabase";

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
  const { data } = await supabase
    .from("users")
    .select("email, deleted_at")
    .eq("id", mobileAuth.user.id)
    .single();
  if (!data || data.deleted_at) return null;

  return { id: mobileAuth.user.id, email: data.email ?? null, role: mobileAuth.user.role ?? null };
}
