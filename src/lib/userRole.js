import supabase from "@/lib/supabase";

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
