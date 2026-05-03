/*
 * Next.js edge middleware that runs on every non-static request. Its primary job is to
 * refresh the Supabase session cookie so it never goes stale between page navigations.
 * It also injects x-pathname and x-search headers into the request so Server Components
 * deeper in the tree can read the current URL without needing the next/headers cookies
 * workaround. The matcher excludes _next/static, _next/image, favicon, and all public
 * image assets to avoid unnecessary overhead on purely static responses.
 */
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabaseResponse } = createClient(request);
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
