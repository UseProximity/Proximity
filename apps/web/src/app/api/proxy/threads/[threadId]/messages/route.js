/*
 * POST /api/proxy/threads/[threadId]/messages  { body, leaseId? }
 *
 * A student's message to Proxy. Proxy answers in the same request (the reply
 * comes back in the response), and anything it set in motion (a question to
 * the landlord) is already recorded. Nothing here emails the student: only
 * what the landlord sends back does (Wyatt, 2026-11-01).
 *
 * @auth public
 */
export const dynamic = "force-dynamic";
// 300: an answer can take several model calls, and the landlord question
// is sent after the reply (PR #365 review; Wyatt, 2026-11-01).
export const maxDuration = 300;

import { NextResponse, after } from "next/server";
import { proxyActor, proxyAvailable } from "@/lib/agents/access";
import { getThread, canAccessThread, shapeMessage } from "@/lib/agents/threads";
import { handleStudentMessage } from "@/lib/agents/proxy";
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
      // Asking the landlord and logging run once the reply is out.
      defer: (work) => after(work),
    });
    if (result.error) return NextResponse.json({ error: result.error, code: result.code ?? null }, { status: result.status ?? 400 });

    return NextResponse.json({
      messages: result.messages.map((m) => shapeMessage(m, { userId: actor.userId })),
      outcome: result.outcome,
      intent: result.intent,
      questionIds: result.questionIds,
    });
  } catch (err) {
    console.error("POST /api/proxy/threads/[id]/messages failed:", err);
    return NextResponse.json({ error: "Proxy could not answer just now. Please try again." }, { status: 500 });
  }
}
