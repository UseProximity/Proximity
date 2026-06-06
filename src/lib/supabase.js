/*
 * Server-side Supabase admin client using the service role key. The service role bypasses
 * Row Level Security, making this appropriate for trusted server contexts like API routes,
 * auth callbacks, and webhooks — never expose it to the browser. Supports targeting either
 * the production or development Supabase project via the dbTarget argument ("prod" | "dev");
 * omitting it falls back to NODE_ENV so production deployments automatically hit the prod
 * database. getSupabaseClient(dbTarget) creates a fresh client per call (useful in admin
 * routes that need to switch databases). The default export is a singleton targeting
 * NODE_ENV, used by auth.js and the majority of API routes.
 */
import { createClient } from "@supabase/supabase-js";

function makeSupabaseClient(dbTarget) {
  // FORCE_DB_TARGET (set in .env.local, never committed) lets local dev point the
  // default client at a specific database — e.g. FORCE_DB_TARGET=prod to demo against
  // production data. An explicit dbTarget argument still wins over it.
  const forced = process.env.FORCE_DB_TARGET;
  const effectiveTarget = dbTarget ?? (forced === "prod" || forced === "dev" ? forced : undefined);
  const isProd =
    effectiveTarget === "prod" ||
    (!effectiveTarget && process.env.NODE_ENV === "production");
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
