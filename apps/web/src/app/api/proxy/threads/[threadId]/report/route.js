/*
 * POST /api/proxy/threads/[threadId]/report  { messageId, reason? }
 *
 * "Report this answer" on a Proxy message. The audit row for the student
 * message it answered is marked, and the team is told. The reporter can be
 * signed out, so this does not use chat_reports (which needs a reporter).
 *
 * @auth public
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { proxyActor } from "@/lib/agents/access";
import { getThread, canAccessThread, UUID_RE } from "@/lib/agents/threads";
import { sendTeamEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/escapeHtml";

export async function POST(req, { params }) {
  try {
    const { threadId } = await params;
    const actor = await proxyActor(req);
    const thread = await getThread(threadId);
    if (!canAccessThread(thread, actor)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const reason = String(body?.reason ?? "").trim().slice(0, 500);
    const messageId = String(body?.messageId ?? "");
    if (!UUID_RE.test(messageId)) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    const { data: msg } = await supabase.from("chat_messages").select("id, body, created_at").eq("id", messageId).eq("thread_id", thread.id).maybeSingle();
    if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });

    const { data: log } = await supabase.from("listing_agent_questions").select("id, question, answer, reported_at").eq("thread_id", thread.id)
      .lte("created_at", new Date(new Date(msg.created_at).getTime() + 5000).toISOString()).order("created_at", { ascending: false }).limit(1);
    const row = log?.[0];
    // One report per answer, and five a day per person: each one emails the
    // team (PR #365 review). A repeat is accepted quietly.
    if (row?.reported_at) return NextResponse.json({ ok: true });
    const who = actor.userId ? ["user_id", actor.userId] : actor.visitorId ? ["visitor_id", actor.visitorId] : null;
    if (who) {
      const { count } = await supabase.from("listing_agent_questions").select("id", { count: "exact", head: true })
        .eq(who[0], who[1]).gte("reported_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      if ((count ?? 0) >= 5) return NextResponse.json({ error: "You've reported several answers today. Thanks; we're looking at them." }, { status: 429 });
    }
    if (row) await supabase.from("listing_agent_questions").update({ reported_at: new Date().toISOString() }).eq("id", row.id);

    await sendTeamEmail({
      to: "info@useproximity.org",
      subject: "A Proxy answer was reported",
      html: `<p>A student reported an answer on listing ${escapeHtml(thread.listing_id)}.</p><p><strong>Question:</strong> ${escapeHtml(row?.question ?? "(unknown)")}</p><p><strong>Answer:</strong> ${escapeHtml(msg.body)}</p>${reason ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ""}<p>Thread ${escapeHtml(thread.id)}.</p>`,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST report failed:", err);
    return NextResponse.json({ error: "Could not send the report" }, { status: 500 });
  }
}
