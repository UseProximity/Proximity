/*
 * GET /api/proxy/threads/[threadId]: the thread's messages, for its student
 * or visitor. Marks it read for a signed-in student.
 *
 * @auth public
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { proxyActor } from "@/lib/agents/access";
import { getThread, canAccessThread, listMessages, shapeMessage, markRead } from "@/lib/agents/threads";

export async function GET(req, { params }) {
  try {
    const { threadId } = await params;
    const actor = await proxyActor(req);
    const thread = await getThread(threadId);
    if (!canAccessThread(thread, actor)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const messages = await listMessages(thread.id);
    await markRead(thread.id, actor.userId);
    return NextResponse.json({
      thread: { id: thread.id, listingId: thread.listing_id, leaseId: thread.lease_id, hasNotifyEmail: !!thread.notify_email, signedIn: !!actor.userId },
      messages: messages.map((m) => shapeMessage(m, { userId: actor.userId })),
    });
  } catch (err) {
    console.error("GET /api/proxy/threads/[id] failed:", err);
    return NextResponse.json({ error: "Could not load the conversation" }, { status: 500 });
  }
}
