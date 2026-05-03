/*
 * Server-side Supabase client using the public anon key and @supabase/ssr's
 * createServerClient. Requires the Next.js cookie store (from next/headers) to be passed
 * in so it can read and refresh the user's Supabase session from cookies. Writes to
 * cookies are silently ignored when called from a Server Component (the middleware handles
 * session refresh there). Use this in Server Components and Route Handlers that need to
 * query Supabase as the currently authenticated user within RLS constraints. For
 * privileged writes that bypass RLS, use the service-role client in src/lib/supabase.js.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const isProd = process.env.NODE_ENV === "production";
const supabaseUrl = (isProd ? process.env.PROD_SUPABASE_URL : process.env.DEV_SUPABASE_URL)!;
const supabaseKey = (isProd ? process.env.PROD_SUPABASE_DEFAULT_KEY : process.env.DEV_SUPABASE_DEFAULT_KEY)!;

export const createClient = (cookieStore: Awaited<ReturnType<typeof cookies>>) => {
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — safe to ignore if middleware
          // is handling session refresh.
        }
      },
    },
  });
};
