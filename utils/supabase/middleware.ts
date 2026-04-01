import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const isProd = process.env.NODE_ENV === "production";
const supabaseUrl = (isProd ? process.env.PROD_SUPABASE_URL : process.env.DEV_SUPABASE_URL)!;
const supabaseKey = (isProd ? process.env.PROD_SUPABASE_DEFAULT_KEY : process.env.DEV_SUPABASE_DEFAULT_KEY)!;

export const createClient = (request: NextRequest) => {
  let supabaseResponse = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  return { supabase, supabaseResponse };
};
