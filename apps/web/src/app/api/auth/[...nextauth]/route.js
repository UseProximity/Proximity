import { handlers } from "@/auth";
import { CLEAR_VISITOR_COOKIE } from "@/lib/visitorCookie";

export const { GET } = handlers;

// Signing out also drops the prx_vid device cookie, so the next person on a
// shared browser starts as a new visitor instead of inheriting this one's
// signed-out chats (lib/matchmaking/anonymousSessions.js).
export async function POST(request, context) {
  const res = await handlers.POST(request, context);
  if (!new URL(request.url).pathname.endsWith("/signout")) return res;
  // Redirect responses carry immutable headers, so copy before appending.
  const out = new Response(res.body, res);
  out.headers.append("Set-Cookie", CLEAR_VISITOR_COOKIE);
  return out;
}
