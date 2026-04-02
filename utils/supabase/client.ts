import { createBrowserClient } from "@supabase/ssr";

const isProd = process.env.NODE_ENV === "production";
const supabaseUrl = (isProd ? process.env.PROD_SUPABASE_URL : process.env.DEV_SUPABASE_URL)!;
const supabaseKey = (isProd ? process.env.PROD_SUPABASE_DEFAULT_KEY : process.env.DEV_SUPABASE_DEFAULT_KEY)!;

export const createClient = () =>
  createBrowserClient(supabaseUrl, supabaseKey);
