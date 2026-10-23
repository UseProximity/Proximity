import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { isSnsUrl, verifySnsMessage } from "@/lib/aws/snsVerify";
import { alertTeam } from "@/lib/chat/deliveryAlerts";
import { TRANSITIONS, statusOf } from "@/lib/chat/emailStatus";

/*
 * Delivery, bounce and complaint reports from Amazon SES, delivered through SNS.
 *
 * Chat alerts are sent with the proximity-chat-alerts configuration set, which
 * publishes DELIVERY, DELIVERY_DELAY, BOUNCE, COMPLAINT, REJECT and
 * RENDERING_FAILURE events to the topic in AWS_SES_EVENTS_TOPIC_ARN.
 *
 * Every event moves the matching chat_email_log row along (Wyatt, 2026-10-23):
 * delivered, delayed, bounced, complained, rejected or failed. A row only moves
 * forward, so a late "delayed" never hides a delivery and a delivery never hides
 * a later spam complaint. Bounces, complaints, rejects and rendering failures on
 * a chat email are also emailed to the team at once. Events for emails this
 * environment did not send (the topic is shared) match no row and change nothing.
 *
 * An address that hard-bounces or marks us as spam goes into email_suppressions
 * and is never emailed again: rpc_chat_notification_recipient falls back to the
 * account email, or sends nothing. This is the handling promised to AWS for SES
 * production access. Soft bounces (full mailbox, temporary failures) are not
 * suppressed; SES retries those, and the row shows 'delayed' meanwhile.
 *
 * Every request is verified as a genuine SNS message from our topic before anything
 * in it is used. The one-time subscription handshake is confirmed here too.
 *
 * @auth public
 */
export async function POST(req) {
  // SNS posts JSON with a text/plain content type, so read it as text.
  const raw = await req.text();
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const ok = await verifySnsMessage(msg, [process.env.AWS_SES_EVENTS_TOPIC_ARN]);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (msg.Type === "SubscriptionConfirmation") {
    if (!isSnsUrl(msg.SubscribeURL)) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const res = await fetch(msg.SubscribeURL);
    if (!res.ok) {
      console.error("SES events: subscription confirm failed:", res.status);
      return NextResponse.json({ error: "Confirm failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  if (msg.Type !== "Notification") {
    return NextResponse.json({ ok: true });
  }

  let event;
  try {
    event = JSON.parse(msg.Message);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const type = event?.eventType || event?.notificationType;
  const tracked = await trackChatEmail(type, event);
  if (!tracked) {
    // 500 makes SNS retry, so a lost status write is not lost for good.
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  let reason = null;
  let recipients = [];
  if (type === "Bounce" && event.bounce?.bounceType === "Permanent") {
    reason = "bounce";
    recipients = event.bounce.bouncedRecipients ?? [];
  } else if (type === "Complaint") {
    reason = "complaint";
    recipients = event.complaint?.complainedRecipients ?? [];
  }

  const emails = [
    ...new Set(
      recipients
        .map((r) => String(r?.emailAddress ?? "").trim().toLowerCase())
        .filter((e) => e.includes("@"))
    ),
  ];
  if (!reason || emails.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const detail = {
    sesMessageId: event.mail?.messageId ?? null,
    bounceSubType: event.bounce?.bounceSubType ?? null,
    complaintType: event.complaint?.complaintFeedbackType ?? null,
  };
  const { error } = await supabase
    .from("email_suppressions")
    .upsert(
      emails.map((email) => ({ email, reason, detail })),
      { onConflict: "email", ignoreDuplicates: true }
    );
  if (error) {
    // 500 makes SNS retry, which is what we want for a lost write.
    console.error("SES events: suppression insert failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  console.log(`SES events: suppressed ${emails.length} address(es) for ${reason}`);
  return NextResponse.json({ ok: true });
}

const TEAM_WORDING = {
  bounced: "The recipient's mail server permanently refused it. The address is now suppressed; future alerts go to the account email if there is one.",
  complained: "The recipient marked it as spam. The address is now suppressed.",
  rejected: "Amazon SES refused to send it.",
  failed: "Amazon SES could not build the email.",
};

/*
 * Update the chat_email_log row for this SES message. Returns false only when
 * the write itself failed.
 */
async function trackChatEmail(type, event) {
  const next = statusOf(type, event);
  const sesId = event?.mail?.messageId;
  if (!next || !sesId) return true;

  const at = event.delivery?.timestamp ?? event.bounce?.timestamp ?? event.complaint?.timestamp ?? event.mail?.timestamp;
  const statusAt = at ? new Date(at).toISOString() : new Date().toISOString();
  const { data: rows, error } = await supabase
    .from("chat_email_log")
    .update({
      status: next.status,
      status_detail: next.detail ? String(next.detail).slice(0, 500) : null,
      status_at: statusAt,
      ...(next.status === "delivered" ? { delivered_at: statusAt } : {}),
    })
    .eq("provider", "ses")
    .eq("provider_message_id", sesId)
    .in("status", TRANSITIONS[next.status])
    .select("thread_id, to_email, kind");
  if (error) {
    console.error("SES events: delivery status update failed:", error);
    return false;
  }

  const row = rows?.[0];
  if (row && TEAM_WORDING[next.status]) {
    await alertTeam({
      subject: `a ${row.kind === "reminder" ? "reply reminder" : "message alert"} ${next.status === "failed" ? "failed" : `was ${next.status}`}`,
      intro: TEAM_WORDING[next.status],
      facts: [
        ["To", row.to_email],
        ["Conversation", row.thread_id],
        ["Detail", next.detail],
      ],
      action: "Reach the recipient another way so they know a message is waiting, and check whether their alert address needs changing.",
    });
  }
  return true;
}
