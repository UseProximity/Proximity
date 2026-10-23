import { auth } from "@/auth";
import supabase from "@/lib/supabase";

/**
 * Guard for privileged routes: returns the session only when the caller's role
 * in the DB is one of `allowed`, otherwise null.
 *
 * Unlike getDbRole callers this fails closed. A token role can be up to
 * ROLE_REFRESH_MS stale (a demoted admin keeps it that long), so admin routes
 * read the role fresh on every request and lock out on any lookup failure.
 */
export async function requireDbRole(allowed) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("users")
    .select("deleted_at, roles!role_id(name)")
    .eq("id", userId)
    .single();
  if (error || !data || data.deleted_at) return null;
  return allowed.includes(data.roles?.name) ? session : null;
}

/**
 * Resolve a user's authoritative role straight from the database.
 *
 * Dashboard routing must NOT trust the role cached in the JWT: a freshly
 * promoted landlord can carry a stale `student` role in their token long after
 * the DB was updated, because the token is only re-minted on sign-in or an
 * explicit client-side session.update() — not on plain server-side `auth()`
 * reads in layouts. Reading the role from the DB here keeps the dashboard
 * routing correct regardless of token staleness.
 *
 * Returns the role name (e.g. "student" | "landlord" | "super") or null if the
 * user can't be found / the lookup fails (callers should fall back to the token
 * role so a transient DB blip doesn't lock anyone out).
 */
export async function getDbRole(email) {
  if (!email) return null;
  const { data, error } = await supabase
    .from("users")
    .select("roles!role_id(name)")
    .eq("email", email)
    .single();
  if (error || !data) return null;
  return data.roles?.name ?? null;
}
