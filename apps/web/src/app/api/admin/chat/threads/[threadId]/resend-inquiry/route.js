export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";
import { ensureReplyAddress, replyDomain, replyToken } from "@/lib/chat/replyAddress";
import { buildChatMessageEmail, getBaseUrl, sendLeadInquiryEmail } from "@/lib/email";
import { chatInquiryDetails } from "@/lib/chat/inquiryDetails";
import { sandboxIdsAmong } from "@/lib/reviewSandbox";

/*
 * Re-send a conversation's first student message to the listing's contact
 * address (Wyatt, 2026-11-17), for an inbox that ignored the original alert.
 * Built exactly like a landlord chat alert (the lib/inquiryEmail.js layout),
 * from the landlord's reply address, so the answer posts into this
 * conversation, and logged like an alert so delivery is tracked.
 *
 * Refused for a review sandbox conversation, a landlord with message emails
 * off, a suppressed (bounced or complained) address, and within two minutes of
 * the last email in the conversation, so a double click sends once.
 *
 * POST { send: true } sends; anything else is a dry run that returns the email
 * and writes nothing.
 *
 * @auth admin
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPEAT_WINDOW_MS = 2 * 60 * 1000;

export async function POST(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { threadId } = await params;
  if (!UUID.test(threadId ?? "")) {
    return Response.json({ error: "Invalid thread id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const send = body?.send === true;

  const supabase = getSupabaseClient();
  try {
    const { data: thread, error: threadError } = await supabase
      .from("chat_threads")
      .select("id, landlord_id, interested_user_id, deleted_at, subject, listing:listings!listing_id(title, address)")
      .eq("id", threadId)
      .maybeSingle();
    if (threadError) throw threadError;
    if (!thread || thread.deleted_at || !thread.landlord_id || !thread.interested_user_id) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    const [student, landlord, first, to, sandboxIds] = await Promise.all([
      supabase.from("users").select("name").eq("id", thread.interested_user_id).maybeSingle(),
      supabase.from("users").select("email, email_notifications").eq("id", thread.landlord_id).maybeSingle(),
      supabase
        .from("chat_messages")
        .select("id, body, message_type, created_at")
        .eq("thread_id", threadId)
        .eq("sender_id", thread.interested_user_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase.rpc("fn_chat_alert_email", { p_thread_id: threadId, p_user_id: thread.landlord_id }),
      sandboxIdsAmong([thread.interested_user_id, thread.landlord_id]),
    ]);
    for (const r of [student, landlord, first, to]) if (r.error) throw r.error;
    if (!first.data?.body || !to.data) {
      return Response.json({ error: "No student message or contact address" }, { status: 409 });
    }
    if (sandboxIds.size > 0) {
      return Response.json({ error: "This is a review sandbox conversation" }, { status: 409 });
    }
    if (landlord.data?.email_notifications === false) {
      return Response.json({ error: "The landlord has message emails turned off" }, { status: 409 });
    }
    const { data: suppressed, error: suppressedError } = await supabase.rpc("fn_email_suppressed", { p_email: to.data });
    if (suppressedError) throw suppressedError;
    if (suppressed) {
      return Response.json({ error: "That address bounced or reported spam, so it is not emailed" }, { status: 409 });
    }

    const { details, ownerFirst } = await chatInquiryDetails({ threadId, recipientId: thread.landlord_id });
    const routed = String(landlord.data?.email ?? "").trim().toLowerCase() !== String(to.data).trim().toLowerCase();
    const email = buildChatMessageEmail({
      senderName: student.data?.name,
      listingTitle: thread.listing?.title,
      listingAddress: thread.listing?.address,
      subject: thread.subject,
      messages: [{ body: first.data.body, messageType: first.data.message_type, createdAt: first.data.created_at }],
      recipientIsInterestedUser: false,
      threadUrl: `${getBaseUrl()}/messages?thread=${threadId}`,
      canReply: true,
      details,
      ownerFirst: routed ? ownerFirst : null,
    });

    if (!send) {
      // The address the send would use, without recording it.
      const token = replyToken({ threadId, userId: thread.landlord_id });
      const from = token ? `reply+${token}@${replyDomain()}` : "(no reply address configured)";
      return Response.json({ dryRun: true, to: to.data, from: `${email.fromName} <${from}>`, subject: email.subject, text: email.text });
    }

    const since = new Date(Date.now() - REPEAT_WINDOW_MS).toISOString();
    const { count: recent, error: recentError } = await supabase
      .from("chat_email_log")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", threadId)
      .eq("recipient_id", thread.landlord_id)
      .gte("created_at", since);
    if (recentError) throw recentError;
    if (recent > 0) {
      return Response.json({ error: "An email went to this inbox in the last two minutes. Wait before sending again." }, { status: 429 });
    }

    const replyTo = await ensureReplyAddress({ threadId, userId: thread.landlord_id });
    if (!replyTo) {
      return Response.json({ error: "Reply address unavailable" }, { status: 500 });
    }

    const sent = await sendLeadInquiryEmail({
      to: to.data, fromName: email.fromName, replyTo, subject: email.subject, text: email.text, html: email.html,
      threadId, recipientId: thread.landlord_id,
    });
    if (sent.suppressed) {
      // Off production nothing goes out, so nothing is logged as sent.
      return Response.json({ sent: false, suppressed: true, to: to.data, subject: email.subject });
    }
    const { error: logError } = await supabase.from("chat_email_log").insert({
      thread_id: threadId,
      message_id: first.data.id,
      recipient_id: thread.landlord_id,
      to_email: to.data,
      kind: "alert",
      provider: "ses",
      provider_message_id: sent.id,
      status: "sent",
      status_detail: `Re-sent by an admin (${session.user?.email ?? session.user?.id ?? "unknown"})`,
      status_at: new Date().toISOString(),
    });
    if (logError) console.error("resend-inquiry: log insert failed:", logError);
    return Response.json({ sent: true, to: to.data, subject: email.subject, sesMessageId: sent.id, logged: !logError });
  } catch (err) {
    console.error("resend-inquiry failed:", err);
    return Response.json({ error: "Could not send the inquiry" }, { status: 500 });
  }
}
