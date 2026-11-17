import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import { clientIp } from "@/lib/auth/loginThrottle";
import { readVisitorId, ipLimited } from "@/lib/matchmaking/anonymousSessions";
import { CLIENT_EVENTS, recordFypEvent } from "@/lib/findYourPlace/events";

export const dynamic = "force-dynamic";

// Events an hour from one network address. A whole dorm shares one address, and
// one visit sends a handful, so this only stops a script.
const IP_LIMIT = 1000;
const PAGES = ["/", "/find-your-place"];

/*
 * Find Your Place tracking from the page (web now, the mobile app once it moves
 * to this flow): which page someone left on, Start over, Edit Preferences, the
 * search cap's Sign in, and the homepage popup. Only the names and fields in
 * lib/findYourPlace/events.js are kept; anything else is dropped quietly.
 * Sent with navigator.sendBeacon, so it always answers 204 and never an error
 * the page would have to handle.
 *
 * @auth public
 */
export async function POST(request) {
  const done = new NextResponse(null, { status: 204 });
  try {
    if (ipLimited(clientIp(request.headers), { bucket: "fyp-events", limit: IP_LIMIT })) return done;
    const body = await request.json().catch(() => null);
    const name = body?.name;
    if (typeof name !== "string" || !CLIENT_EVENTS.includes(name)) return done;

    // A failed account lookup still records the event, just without the account.
    const user = await getRequestUser(request).catch(() => null);
    await recordFypEvent({
      name,
      userId: user?.id ?? null,
      visitorId: readVisitorId(request),
      page: PAGES.includes(body.page) ? body.page : "/find-your-place",
      metadata: body.metadata,
    });
  } catch (err) {
    console.error("[find-your-place events]", err?.message);
  }
  return done;
}
