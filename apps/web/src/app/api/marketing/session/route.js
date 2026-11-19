/*
 * POST /api/marketing/session: the marketing session beacon (PRD 7.2).
 *
 * Sent by MarketingBeacon from the browser after a page loads and on every
 * route change. Created here rather than on the page request, so most bots
 * (which never run JavaScript) never make a session.
 *
 *   - No live session: classify the visit (campaign link, UTMs, src, gclid,
 *     referrer) and create one.
 *   - Live session: renew it, attach the signed-in user if missing, and log a
 *     campaign arrival as a touchpoint without changing the session's source.
 *   - Either way: record guides_visit / hub_visit for the path (once per
 *     session) and set the 30-minute HttpOnly session cookie.
 *
 * Public by design (signed-out visitors are most of the traffic). Rate limited
 * per IP, body capped at 2 KB. Always answers 204 and never reports internal
 * errors: a failed beacon must not affect the page.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clientIp } from "@/lib/auth/loginThrottle";
import { classifyVisit, hasCampaignSignal, readCampaignParams } from "@/lib/marketing/classify";
import { SESSION_COOKIE, attributionEnabled, sessionCookieOptions } from "@/lib/marketing/config";
import { visitOutcomesForPath } from "@/lib/marketing/outcomes";
import { beaconRateLimited } from "@/lib/marketing/rateLimit";
import { recordOutcome } from "@/lib/marketing/record";
import {
  addTouchpoint,
  createSession,
  findLinkBySlug,
  loadLiveSession,
  readSessionCookie,
  touchSession,
} from "@/lib/marketing/sessions";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;
const noContent = () => new NextResponse(null, { status: 204 });

// Pages whose path carries a credential. The token is replaced before the
// path is stored as a landing path or touchpoint, so these tables never hold a
// working link (the review-invite page treats its token as the whole security
// story and will not even echo it into the DOM).
const SECRET_PATHS = [/^(\/review-invite\/t\/)[^/]+/];

function cleanPath(raw) {
  let p = String(raw ?? "").split("#")[0].split("?")[0];
  if (!p.startsWith("/") || p.startsWith("//")) return null;
  for (const re of SECRET_PATHS) p = p.replace(re, "$1:token");
  return p.slice(0, 500);
}

async function readBody(req) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return null;
  const text = await req.text();
  if (!text || text.length > MAX_BODY_BYTES) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

export async function POST(req) {
  if (!attributionEnabled()) return noContent();
  if (beaconRateLimited(clientIp(req.headers))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const path = cleanPath(body.path);
  if (!path) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const search = typeof body.search === "string" ? body.search.slice(0, 1500) : "";
  const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, 500) : "";

  try {
    const authSession = await auth();
    const userId = authSession?.user?.id || null;
    const ownHost = new URL(req.url).hostname;
    const ownHosts = ["useproximity.org", ownHost];

    let session = await loadLiveSession(await readSessionCookie(req));
    const signal = hasCampaignSignal(search);
    const link = signal ? await findLinkBySlug(readCampaignParams(search).srcTag) : null;

    if (session) {
      await touchSession(session, { userId });
      if (signal) {
        const classification = classifyVisit({ params: search, referrer, link, ownHosts });
        await addTouchpoint(session, classification, path);
      }
    } else {
      const classification = classifyVisit({ params: search, referrer, link, ownHosts });
      session = await createSession(classification, { landingPath: path, userId });
    }

    for (const outcome of visitOutcomesForPath(path)) {
      await recordOutcome(req, { outcome, sessionId: session.id, userId, userRole: authSession?.user?.role || null });
    }

    const res = noContent();
    res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("marketing beacon failed:", err?.message || err);
    return noContent();
  }
}
