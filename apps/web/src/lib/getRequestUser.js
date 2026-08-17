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

  const { data } = await supabase.from("users").select("email").eq("id", mobileAuth.user.id).single();
  return { id: mobileAuth.user.id, email: data?.email ?? null, role: mobileAuth.user.role ?? null };
}
