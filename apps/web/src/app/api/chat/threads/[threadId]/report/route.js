/*
 * POST /api/chat/threads/[threadId]/report { reason, messageId? }
 *
 * Files a report about the other person in this conversation, optionally pointing
 * at one of their messages. The reported user is derived from the thread and the
 * excerpt from the stored message, never taken from the request. Reports are a
 * plain queue in chat_reports for staff to read by hand (service role only); the
 * conversation itself stays in chat_messages for context. The person reported is
 * not told. Reporting the same message, or the same conversation, twice is a
 * success that adds nothing.
 *
 * @auth user
 */
import { NextResponse } from "next/server";
import { CHAT_REPORT_REASON_VALUES } from "@proximity/shared";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { resolveThreadCounterpart } from "@/lib/chat/safety";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXCERPT_MAX = 500;

export async function POST(req, { params }) {
  try {
    const authUser = await getRequestUser(req);
    if (!authUser?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { threadId } = await params;
    if (!UUID_RE.test(threadId ?? "")) {
      return NextResponse.json({ error: "threadId must be a valid UUID" }, { status: 400 });
    }

    const payload = await req.json().catch(() => ({}));
    const { reason, messageId } = payload ?? {};
    if (typeof reason !== "string" || !CHAT_REPORT_REASON_VALUES.includes(reason)) {
      return NextResponse.json({ error: "Choose a reason for your report" }, { status: 400 });
    }
    if (messageId !== undefined && messageId !== null) {
      if (typeof messageId !== "string" || !UUID_RE.test(messageId)) {
        return NextResponse.json({ error: "messageId must be a valid UUID" }, { status: 400 });
      }
    }

    const target = await resolveThreadCounterpart(threadId, authUser.id);
    if (!target.ok) {
      return NextResponse.json({ error: target.error }, { status: target.status });
    }

    let excerpt = null;
    if (messageId) {
      const { data: message, error: messageError } = await supabase
        .from("chat_messages")
        .select("id, thread_id, sender_id, body")
        .eq("id", messageId)
        .maybeSingle();
      if (messageError) {
        console.error("POST /api/chat/threads/[threadId]/report message lookup failed:", messageError);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
      }
      if (!message || message.thread_id !== threadId) {
        return NextResponse.json({ error: "Message not found" }, { status: 404 });
      }
      if (message.sender_id === authUser.id) {
        return NextResponse.json({ error: "You can't report your own message" }, { status: 400 });
      }
      excerpt = message.body ? message.body.trim().slice(0, EXCERPT_MAX) || null : null;
    }

    const { error } = await supabase.from("chat_reports").insert({
      reporter_id: authUser.id,
      reported_user_id: target.otherUserId,
      thread_id: threadId,
      message_id: messageId ?? null,
      reason,
      message_excerpt: excerpt,
    });

    // 23505 = already reported by this user. Treat as success.
    if (error && error.code !== "23505") {
      console.error("POST /api/chat/threads/[threadId]/report insert failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/chat/threads/[threadId]/report failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
