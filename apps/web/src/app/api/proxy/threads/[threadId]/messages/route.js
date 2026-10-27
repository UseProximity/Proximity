/*
 * POST /api/proxy/threads/[threadId]/messages  { body, leaseId? }
 *
 * A student's message to Proxy. Proxy answers in the same request (the reply
 * comes back in the response), and anything it set in motion (a question to
 * the landlord) is already recorded. The student's email, if they have left
 * the page, goes out after the response with the usual quiet window.
 *
 * @auth public
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse, after } from "next/server";
import { proxyActor, proxyAvailable } from "@/lib/agents/access";
import { getThread, canAccessThread, shapeMessage } from "@/lib/agents/threads";
import { handleStudentMessage } from "@/lib/agents/proxy";
import { notifyStudentThread } from "@/lib/agents/notify";
import { clientIp } from "@/lib/auth/loginThrottle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req, { params }) {
  try {
    const { threadId } = await params;
    const actor = await proxyActor(req);
    const thread = await getThread(threadId);
    if (!canAccessThread(thread, actor)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const avail = await proxyAvailable({ listingId: thread.listing_id, userId: actor.userId, role: actor.role });
    if (!avail.ok) return NextResponse.json({ error: avail.error }, { status: avail.status });

    let body;
    try { body = await req.json(); } catch { body = {}; }
    const leaseId = UUID.test(body?.leaseId ?? "") ? body.leaseId : null;

    const result = await handleStudentMessage({
      thread, body: body?.body, userId: actor.userId, visitorId: actor.visitorId,
      ip: clientIp(req.headers), leaseId, testMode: avail.testMode,
    });
    if (result.error) return NextResponse.json({ error: result.error, code: result.code ?? null }, { status: result.status ?? 400 });

    if (!avail.testMode && result.messages.some((m) => m.message_type === "proxy_answer" || m.message_type === "proxy_asked")) {
      after(() => notifyStudentThread({ threadId: thread.id, kind: "proxy_answer" }));
    }
    return NextResponse.json({
      messages: result.messages.map((m) => shapeMessage(m, { userId: actor.userId })),
      outcome: result.outcome,
      questionIds: result.questionIds,
    });
  } catch (err) {
    console.error("POST /api/proxy/threads/[id]/messages failed:", err);
    return NextResponse.json({ error: "Proxy could not answer just now. Please try again." }, { status: 500 });
  }
}
