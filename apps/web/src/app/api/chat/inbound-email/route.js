import { NextResponse } from "next/server";
import { isSnsUrl, verifySnsMessage } from "@/lib/aws/snsVerify";
import { processInboundEmail } from "@/lib/chat/inboundEmail";

export const maxDuration = 60;

/*
 * Replies to chat alert emails, delivered by Amazon SES through SNS.
 *
 * SES stores each message for this environment's reply domain in S3 and posts
 * a notification here naming the object. Prod and staging each have their own
 * topic (AWS_INBOUND_TOPIC_ARN), so a staging reply can never land in a
 * production conversation. Everything in the request is verified as a genuine
 * SNS message from that topic before it is used; the email itself is then read
 * from S3, never from the request body.
 *
 * Processing is idempotent per S3 object, so SNS retries are harmless. A
 * failure that should be retried returns 500; a message that was received and
 * deliberately dropped returns 200.
 *
 * @auth public
 */
export async function POST(req) {
  const raw = await req.text();
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const ok = await verifySnsMessage(msg, [process.env.AWS_INBOUND_TOPIC_ARN]);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (msg.Type === "SubscriptionConfirmation") {
    if (!isSnsUrl(msg.SubscribeURL)) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const res = await fetch(msg.SubscribeURL);
    return NextResponse.json({ ok: res.ok }, { status: res.ok ? 200 : 502 });
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

  const action = event?.receipt?.action;
  if (event?.notificationType !== "Received" || action?.type !== "S3" || !action.objectKey) {
    return NextResponse.json({ ok: true });
  }
  if (action.bucketName !== process.env.AWS_INBOUND_MAIL_BUCKET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await processInboundEmail({
    bucket: action.bucketName,
    key: action.objectKey,
    recipients: event.receipt.recipients ?? [],
  });
  if (result.status === "error") {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
