export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";
import { ensureReplyAddress } from "@/lib/chat/replyAddress";
import { getBaseUrl, sendLeadInquiryEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/escapeHtml";

/*
 * Re-send a conversation's first student message to the listing's contact
 * address as a plain inquiry from the student (Wyatt, 2026-11-17). For leasing
 * assistants such as EliseAI that ignored our notification-style alert. The
 * message comes first, then what we know about the student and the unit, never
 * their contact details. Sent from the landlord's reply address, so the answer
 * posts into this conversation, and logged like an alert so delivery is tracked.
 *
 * POST { send: true } sends; anything else is a dry run that returns the email.
 *
 * @auth admin
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unitLabel(lease) {
  const unit = lease?.unit;
  if (!unit) return null;
  const beds = unit.bedrooms === 0 ? "Studio" : unit.bedrooms ? `${unit.bedrooms} bed` : null;
  const apt = String(lease.description ?? "").match(/\bApt\.?\s+[\w-]+/i)?.[0];
  const parts = [
    beds,
    apt,
    unit.area ? `${unit.area} sq ft` : null,
    lease.rent ? `$${Number(lease.rent).toLocaleString("en-US")}/month` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

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
    const { data: thread } = await supabase
      .from("chat_threads")
      .select("id, landlord_id, interested_user_id, deleted_at, listing:listings!listing_id(title), lease:unit_leases!lease_id(rent, description, unit:listing_units!unit_id(bedrooms, area))")
      .eq("id", threadId)
      .maybeSingle();
    if (!thread || thread.deleted_at || !thread.landlord_id || !thread.interested_user_id) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    const [{ data: student }, { data: landlord }, { data: first }, { data: to }] = await Promise.all([
      supabase.from("users").select("name, graduation_year").eq("id", thread.interested_user_id).maybeSingle(),
      supabase.from("users").select("name").eq("id", thread.landlord_id).maybeSingle(),
      supabase
        .from("chat_messages")
        .select("id, body")
        .eq("thread_id", threadId)
        .eq("sender_id", thread.interested_user_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase.rpc("fn_chat_alert_email", { p_thread_id: threadId, p_user_id: thread.landlord_id }),
    ]);
    if (!first?.body || !to) {
      return Response.json({ error: "No student message or contact address" }, { status: 409 });
    }

    // "Hi Yuki," was written to the account owner, who is not who reads a leasing inbox.
    const landlordFirst = String(landlord?.name ?? "").trim().split(/\s+/)[0];
    const message = landlordFirst
      ? first.body.replace(new RegExp(`^(\\s*(hi|hey|hello))\\s+${landlordFirst.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "$1")
      : first.body;
    const studentName = String(student?.name ?? "").trim() || "A student";
    const listingTitle = thread.listing?.title ?? "your listing";
    const details = [
      unitLabel(thread.lease) && `Interested in: ${unitLabel(thread.lease)}`,
      student?.graduation_year ? `Student, class of ${student.graduation_year}` : "Student",
    ].filter(Boolean);
    const conversationUrl = `${getBaseUrl()}/messages?thread=${threadId}`;
    const subject = `Inquiry about ${listingTitle}`;
    const text = [message, "", studentName, "", "--", "Sent through Proximity (useproximity.org)", ...details, `Conversation: ${conversationUrl}`].join("\n");

    const replyTo = await ensureReplyAddress({ threadId, userId: thread.landlord_id });
    if (!replyTo) {
      return Response.json({ error: "Reply address unavailable" }, { status: 500 });
    }
    if (!send) {
      return Response.json({ dryRun: true, to, from: `${studentName} <${replyTo}>`, subject, text });
    }

    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">
<p style="margin:0 0 12px;white-space:pre-line">${escapeHtml(message)}</p>
<p style="margin:0 0 24px">${escapeHtml(studentName)}</p>
<div style="border-top:1px solid #e5e7eb;padding-top:12px;font-size:13px;color:#6b7280">
<p style="margin:0 0 4px">Sent through Proximity (useproximity.org)</p>
${details.map((d) => `<p style="margin:0 0 4px">${escapeHtml(d)}</p>`).join("\n")}
<p style="margin:0">Conversation: <a href="${conversationUrl}" style="color:#E82027">${escapeHtml(conversationUrl)}</a></p>
</div></div>`;

    const sesId = await sendLeadInquiryEmail({
      to, fromName: studentName, replyTo, subject, text, html, threadId, recipientId: thread.landlord_id,
    });
    const { error: logError } = await supabase.from("chat_email_log").insert({
      thread_id: threadId,
      message_id: first.id,
      recipient_id: thread.landlord_id,
      to_email: to,
      kind: "alert",
      provider: "ses",
      provider_message_id: sesId,
      status: "sent",
      status_at: new Date().toISOString(),
    });
    if (logError) console.error("resend-inquiry: log insert failed:", logError);
    return Response.json({ sent: true, to, subject, sesMessageId: sesId, logged: !logError });
  } catch (err) {
    console.error("resend-inquiry failed:", err);
    return Response.json({ error: "Could not send the inquiry" }, { status: 500 });
  }
}
