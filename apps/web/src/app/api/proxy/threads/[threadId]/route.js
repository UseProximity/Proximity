/*
 * GET /api/proxy/threads/[threadId]: the thread's messages, for its student
 * or visitor. Marks it read for a signed-in student.
 *
 * An admin viewing a student's inbox (?viewAs=<student id>, Wyatt,
 * 2026-11-03) reads the student's thread as the student would see it, and
 * nothing is marked read.
 *
 * @auth public
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { proxyActor } from "@/lib/agents/access";
import { getThread, canAccessThread, listMessages, shapeMessage, markRead } from "@/lib/agents/threads";
import { getRequestUser } from "@/lib/getRequestUser";
import { inboxViewAsId } from "@/lib/users/viewAs";

export async function GET(req, { params }) {
  try {
    const { threadId } = await params;
    const caller = await getRequestUser(req).catch(() => null);
    const viewAsId = caller ? inboxViewAsId(caller, new URL(req.url).searchParams) : null;
    const thread = await getThread(threadId);
    let actor;
    if (viewAsId) {
      if (!thread || thread.deleted_at || thread.interested_user_id !== viewAsId) return NextResponse.json({ error: "Not found" }, { status: 404 });
      actor = { userId: viewAsId };
    } else {
      actor = await proxyActor(req);
      if (!canAccessThread(thread, actor)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const messages = await listMessages(thread.id);
    if (!viewAsId) await markRead(thread.id, actor.userId);
    return NextResponse.json({
      thread: { id: thread.id, listingId: thread.listing_id, leaseId: thread.lease_id, hasNotifyEmail: !!thread.notify_email, signedIn: !!actor.userId },
      messages: messages.map((m) => shapeMessage(m, { userId: actor.userId })),
    });
  } catch (err) {
    console.error("GET /api/proxy/threads/[id] failed:", err);
    return NextResponse.json({ error: "Could not load the conversation" }, { status: 500 });
  }
}
