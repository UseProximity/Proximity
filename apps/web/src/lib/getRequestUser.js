import { auth } from "@/auth";
import { authMobile } from "@/lib/authMobile";
import supabase from "@/lib/supabase";

/**
 * Resolves the current request's user via the NextAuth session (web) first,
 * falling back to a mobile Bearer token. Always returns { id, email } (or
 * null) regardless of which auth path matched, so callers don't need to
 * special-case web vs mobile.
 */
export async function getRequestUser(req) {
  const session = await auth();
  if (session?.user?.id) {
    return { id: session.user.id, email: session.user.email ?? null };
  }

  const mobileAuth = await authMobile(req);
  if (!mobileAuth?.user?.id) return null;

  const { data } = await supabase.from("users").select("email").eq("id", mobileAuth.user.id).single();
  return { id: mobileAuth.user.id, email: data?.email ?? null };
}
