import { createClient } from "@supabase/supabase-js";

function makeSupabaseClient(dbTarget) {
  const isProd = dbTarget === "prod" || (!dbTarget && process.env.NODE_ENV === "production");
  const supabaseUrl = isProd ? process.env.PROD_SUPABASE_URL : process.env.DEV_SUPABASE_URL;
  const supabaseServiceRoleKey = isProd
    ? process.env.PROD_SUPABASE_SERVICE_KEY
    : process.env.DEV_SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error(`Missing ${isProd ? "PROD" : "DEV"}_SUPABASE_URL env var`);
  }
  if (!supabaseServiceRoleKey) {
    throw new Error(`Missing ${isProd ? "PROD" : "DEV"}_SUPABASE_SERVICE_KEY env var`);
  }

  // Server-side client — uses the service role key, never expose to the browser
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Create a Supabase admin client targeting a specific database.
 * Pass "prod" or "dev" to override NODE_ENV selection.
 * Omit (or pass undefined) to fall back to NODE_ENV.
 */
export function getSupabaseClient(dbTarget) {
  return makeSupabaseClient(dbTarget);
}

// Default singleton uses NODE_ENV — kept for backward compatibility
const supabase = makeSupabaseClient(undefined);
export default supabase;
