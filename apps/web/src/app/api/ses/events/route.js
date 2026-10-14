import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { isSnsUrl, verifySnsMessage } from "@/lib/aws/snsVerify";

/*
 * Bounce and complaint reports from Amazon SES, delivered through SNS.
 *
 * Chat alerts are sent with the proximity-chat-alerts configuration set, which
 * publishes BOUNCE, COMPLAINT and REJECT events to the topic in
 * AWS_SES_EVENTS_TOPIC_ARN. An address that hard-bounces or marks us as spam goes
 * into email_suppressions and is never emailed again: rpc_chat_notification_recipient
 * falls back to the account email, or sends nothing. This is the handling promised
 * to AWS for SES production access.
 *
 * Soft bounces (full mailbox, temporary failures) are ignored; SES retries those.
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
