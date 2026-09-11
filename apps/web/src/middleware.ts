/*
 * Next.js middleware, running on every non-static request. Its only job is to inject
 * x-pathname and x-search into the request headers so Server Components deeper in the
 * tree can read the current URL. Exactly one file consumes them today:
 * src/app/dashboard/layout.js.
 *
 * It used to also build an @supabase/ssr server client on every request to refresh a
 * Supabase session cookie. The app authenticates with NextAuth and has never used
 * Supabase Auth, so that cookie was never set and the client was constructed and then
 * discarded without a single call being made on it.
 *
 * The matcher excludes _next/static, _next/image, favicon and public image assets to
 * avoid running on purely static responses.
 */
import { type NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  headers.set("x-search", request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
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
