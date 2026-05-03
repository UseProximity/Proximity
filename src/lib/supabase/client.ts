/*
 * Browser-side Supabase client using the public anon key and @supabase/ssr's
 * createBrowserClient. This client is safe to use in "use client" components and is
 * subject to Row Level Security policies. Targets the production or development Supabase
 * project based on NODE_ENV. Use this when you need a Supabase client inside a React
 * component or client-side hook. For server components and API routes, use the server
 * client instead (src/lib/supabase/server.ts or src/lib/supabase.js for admin access).
 */
import { createBrowserClient } from "@supabase/ssr";

const isProd = process.env.NODE_ENV === "production";
const supabaseUrl = (isProd ? process.env.PROD_SUPABASE_URL : process.env.DEV_SUPABASE_URL)!;
const supabaseKey = (isProd ? process.env.PROD_SUPABASE_DEFAULT_KEY : process.env.DEV_SUPABASE_DEFAULT_KEY)!;

export const createClient = () =>
  createBrowserClient(supabaseUrl, supabaseKey);
