/*
 * Browser-side Supabase client using the public anon key and @supabase/ssr's
 * createBrowserClient. This client is safe to use in "use client" components and is
 * subject to Row Level Security policies. next.config.mjs resolves the environment's
 * dev/prod target at build time and exposes only the selected public URL and anon key.
 * Use this when you need a Supabase client inside a React component or client-side hook.
 * For server components and API routes, use the server client instead
 * (src/lib/supabase/server.ts or src/lib/supabase.js for admin access).
 */
import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_DEFAULT_KEY!;

export const createClient = () =>
  createBrowserClient(supabaseUrl, supabaseKey);
