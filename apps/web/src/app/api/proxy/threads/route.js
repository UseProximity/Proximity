/*
 * POST /api/proxy/threads  { listingId, leaseId? }
 *
 * Open (or reuse) the caller's Proxy thread for a listing: one per listing
 * per signed-in student or per signed-out visitor cookie. Returns the thread
 * and its messages. A first-time visitor gets their cookie on this response.
 *
 * A landlord opening their own listing, or an admin, gets a test thread:
 * real answers, nothing logged or sent on.
 *
 * @auth public
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { proxyActor, proxyAvailable } from "@/lib/agents/access";
import { getOrCreateProxyThread, listMessages, shapeMessage, markRead, claimVisitorThreads } from "@/lib/agents/threads";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
  try {
    const actor = await proxyActor(req);
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const listingId = String(body?.listingId ?? "");
    const leaseId = UUID.test(body?.leaseId ?? "") ? body.leaseId : null;
    if (!UUID.test(listingId)) return actor.withCookie(NextResponse.json({ error: "listingId is required" }, { status: 400 }));

    const avail = await proxyAvailable({ listingId, userId: actor.userId, role: actor.role });
    if (!avail.ok) return actor.withCookie(NextResponse.json({ error: avail.error }, { status: avail.status }));

    // A signed-in student who asked while signed out: those threads are theirs now.
    if (actor.userId && actor.cookieVisitorId) {
      await claimVisitorThreads({ visitorId: actor.cookieVisitorId, userId: actor.userId }).catch((err) => console.error("[proxy] claim failed:", err?.message ?? err));
    }

    const { thread } = await getOrCreateProxyThread({ listingId, userId: actor.userId, visitorId: actor.visitorId, leaseId });
    const messages = await listMessages(thread.id);
    await markRead(thread.id, actor.userId);
    return actor.withCookie(NextResponse.json({
      thread: { id: thread.id, listingId, leaseId: thread.lease_id, hasNotifyEmail: !!thread.notify_email, signedIn: !!actor.userId },
      messages: messages.map((m) => shapeMessage(m, { userId: actor.userId })),
      testMode: avail.testMode,
    }));
  } catch (err) {
    console.error("POST /api/proxy/threads failed:", err);
    return NextResponse.json({ error: "Could not open the conversation" }, { status: 500 });
  }
}
