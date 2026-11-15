/*
 * Which database an admin route reads: the dashboard's dev/prod switch, sent as
 * the x-db-target header. `writable` is true only when that is this site's own
 * database. Routes whose rows point at the signed-in team member (a note's
 * author, say) only write there, because the same person has a different user
 * id in the other environment. Same rule as lib/billing/adminDb.js.
 *
 *   adminDb(req)   { db, target, own, writable }
 */
import supabase, { getSupabaseClient } from "@/lib/supabase";
import { isProdData } from "@/lib/appEnv";

export function adminDb(req) {
  const asked = req?.headers?.get?.("x-db-target");
  const own = isProdData() ? "prod" : "dev";
  const target = asked === "prod" || asked === "dev" ? asked : own;
  return { db: target === own ? supabase : getSupabaseClient(target), target, own, writable: target === own };
}

// PostgREST's answer when a table or column is not there yet (a migration that
// has reached dev but not prod).
export const missingTable = (error) => !!error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204");
