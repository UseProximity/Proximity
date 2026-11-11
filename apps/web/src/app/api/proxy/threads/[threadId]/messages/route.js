/*
 * POST /api/proxy/threads/[threadId]/messages  { body, leaseId? }
 *
 * A student's message to Proxy. Proxy answers in the same request (the reply
 * comes back in the response), and anything it set in motion (a question to
 * the landlord) is already recorded. Nothing here emails the student: only
 * what the landlord sends back does (Wyatt, 2026-11-01).
 *
 * Sent with "Accept: application/x-ndjson", the answer streams as it is
 * written (Wyatt, 2026-11-11), one JSON object per line:
 *   { type: "delta", text }                          more of Proxy's reply
 *   { type: "done", messages, outcome, intent, ... } the saved messages, as the plain response
 *   { type: "error", error, code }                   in place of done
 * Checks that fail before Proxy starts (no access, not available) still
 * answer with a plain JSON error and status. Without the header, the plain
 * JSON response as before (the mobile app).
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

    const args = { thread, body: body?.body, userId: actor.userId, visitorId: actor.visitorId, ip: clientIp(req.headers), leaseId, testMode: avail.testMode };
    const shape = (result) => ({
      messages: result.messages.map((m) => shapeMessage(m, { userId: actor.userId })),
      outcome: result.outcome,
      intent: result.intent,
      questionIds: result.questionIds,
    });

    if ((req.headers.get("accept") ?? "").includes("application/x-ndjson")) {
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (obj) => { try { controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`)); } catch {} };
          // The work after the reply (asking the landlord, logging) runs once
          // "done" is sent; the stream stays open until it finishes, so the
          // function lives that long, and the student is not waiting on it.
          let later = null;
          try {
            const result = await handleStudentMessage({ ...args, defer: (work) => { later = work; }, onReplyDelta: (text) => send({ type: "delta", text }) });
            if (result.error) send({ type: "error", error: result.error, code: result.code ?? null });
            else send({ type: "done", ...shape(result) });
          } catch (err) {
            console.error("POST /api/proxy/threads/[id]/messages (stream) failed:", err);
            send({ type: "error", error: "Proxy could not answer just now. Please try again." });
          }
          if (later) await later();
          try { controller.close(); } catch {}
        },
      });
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
    }

    const result = await handleStudentMessage({
      ...args,
      // Asking the landlord and logging run once the reply is out.
      defer: (work) => after(work),
    });
    if (result.error) return NextResponse.json({ error: result.error, code: result.code ?? null }, { status: result.status ?? 400 });

    return NextResponse.json(shape(result));
  } catch (err) {
    console.error("POST /api/proxy/threads/[id]/messages failed:", err);
    return NextResponse.json({ error: "Proxy could not answer just now. Please try again." }, { status: 500 });
  }
}
