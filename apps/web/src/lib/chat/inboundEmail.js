/*
 * Post an emailed reply into its chat conversation.
 *
 * SES receives mail for reply+<token>@<reply domain>, stores the raw message in
 * S3 and, on prod and staging, notifies /api/chat/inbound-email over SNS. Locally
 * there is no public URL for SNS, so /api/dev/inbound-email runs the same thing
 * against the dev/ prefix by hand.
 *
 * A reply is posted only if every check passes, in this order:
 *   1. SES did not mark it as spam or a virus.
 *   2. It is not an automatic message (out of office, bounce, mailing list).
 *   3. The From domain is authenticated: DMARC pass, or an SPF or DKIM pass for
 *      that same domain. A forged From cannot get past this.
 *   4. The reply address belongs to someone in a live conversation.
 *   5. It comes from that person: their account email, the alert address this
 *      conversation emails them at, or another mailbox at the same company
 *      domain (never a free mail domain or wustl.edu, where sharing a domain
 *      proves nothing). Forwards are refused (Wyatt, 2026-10-09).
 *   6. Something is left once the quoted email and signature are removed.
 * Then contact details and the like are redacted rather than refused, and the
 * text goes in through rpc_send_chat_message like any in-app message, so it is
 * stored, rate limited and delivered exactly the same way.
 *
 * Spam, automatic mail and unauthenticated mail are dropped silently. The others
 * get a short "not delivered" email, at most one per sender per conversation per
 * day, and only when the sender was authenticated so we never mail a forged
 * address. Every message received is recorded in chat_inbound_emails.
 */
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { simpleParser } from "mailparser";
import supabase from "@/lib/supabase";
import { outreachEnabled } from "@/lib/appEnv";
import { getBaseUrl, sendReplyNotDeliveredEmail } from "@/lib/email";
import { extractReplyText } from "@/lib/chat/emailReplyText";
import { redactChatText } from "@/lib/chat/moderation";
import { hashReplyToken, replyDomain } from "@/lib/chat/replyAddress";
import { notifyNewChatMessage } from "@/lib/chat/notifyEmail";

const MAX_BODY = 5000;
const NOTICE_EVERY_MS = 24 * 60 * 60 * 1000;

// Sharing one of these domains says nothing about being the same business.
const SHARED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "gmx.us", "mail.com", "yandex.com", "zoho.com",
  "zohomail.com", "fastmail.com", "hey.com", "att.net", "sbcglobal.net", "comcast.net",
  "verizon.net", "charter.net", "wustl.edu",
]);

let s3;
function mailBucketClient() {
  s3 ??= new S3Client({
    region: process.env.AWS_SES_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY,
    },
  });
  return s3;
}

function domainOf(email) {
  return String(email ?? "").trim().toLowerCase().split("@")[1] || "";
}

function aligned(a, b) {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function headerText(parsed, name) {
  const value = parsed.headers.get(name);
  if (value == null) return "";
  const one = (v) => {
    // Address headers parse to { value: [{ address, name }], text }.
    if (v && typeof v === "object" && Array.isArray(v.value)) {
      return v.value.map((a) => a.address ?? "").concat(v.text ?? "").join(" ");
    }
    if (v && typeof v === "object" && "value" in v) return String(v.value);
    return String(v);
  };
  return Array.isArray(value) ? value.map(one).join("\n") : one(value);
}

/** SPF/DKIM/DMARC from the Authentication-Results header SES adds. */
export function authenticated(parsed, fromEmail) {
  const all = parsed.headerLines
    .filter((h) => h.key === "authentication-results")
    .map((h) => h.line.replace(/^authentication-results:\s*/i, "").replace(/\s+/g, " "));
  const results = all.find((r) => /^amazonses\.com\b/i.test(r));
  if (!results) return false;

  const fromDomain = domainOf(fromEmail);
  const dmarc = results.match(/\bdmarc=(\w+)/i)?.[1]?.toLowerCase();
  if (dmarc === "pass") return true;
  if (dmarc === "fail") return false;

  const spfPass = /\bspf=pass\b/i.test(results);
  const mailFrom = results.match(/smtp\.mailfrom=([^\s;]+)/i)?.[1] ?? "";
  if (spfPass && aligned(domainOf(mailFrom.includes("@") ? mailFrom : `x@${mailFrom}`), fromDomain)) {
    return true;
  }

  for (const m of results.matchAll(/\bdkim=pass\b[^;]*?header\.(?:i|d)=@?([^\s;]+)/gi)) {
    if (aligned(m[1].toLowerCase().replace(/^.*@/, ""), fromDomain)) return true;
  }
  return false;
}

/** Out of office, bounces, mailing lists and other mail no person typed. */
export function isAutomatic(parsed) {
  const h = (name) => headerText(parsed, name).trim().toLowerCase();
  const auto = h("auto-submitted");
  if (auto && auto !== "no") return true;
  if (h("x-autoreply") || h("x-autorespond") || h("x-auto-response-suppress")) return true;
  if (/^(bulk|junk|list|auto_reply)$/.test(h("precedence"))) return true;
  if (h("list-id") || h("list-unsubscribe")) return true;
  if (h("return-path") === "<>") return true;
  if (/multipart\/report/.test(h("content-type"))) return true;
  return /^(auto(matic)?[ -]?reply|out of (the )?office|autoreply|undeliverable|delivery status notification|mail delivery (failed|subsystem))/i.test(
    String(parsed.subject ?? "").trim()
  );
}

/** The reply token from whichever recipient carries our address. */
export function findReplyToken(parsed, recipients = []) {
  const domain = replyDomain().replace(/\./g, "\\.");
  const re = new RegExp(`reply\\+([a-f0-9]{32})@${domain}`, "i");
  const candidates = [
    ...recipients,
    ...["to", "cc", "delivered-to", "x-original-to"].map((k) => headerText(parsed, k)),
  ];
  for (const c of candidates) {
    const m = String(c ?? "").match(re);
    if (m) return { token: m[1].toLowerCase(), address: m[0].toLowerCase() };
  }
  return null;
}

async function finish(id, fields) {
  const { error } = await supabase.from("chat_inbound_emails").update(fields).eq("id", id);
  if (error) console.error("inbound email: log update failed:", error);
}

async function maybeSendNotice({ logId, fromEmail, threadId, reason }) {
  const since = new Date(Date.now() - NOTICE_EVERY_MS).toISOString();
  let q = supabase
    .from("chat_inbound_emails")
    .select("id", { head: true, count: "exact" })
    .eq("from_email", fromEmail)
    .gte("notice_sent_at", since);
  q = threadId ? q.eq("thread_id", threadId) : q.is("thread_id", null);
  const { count } = await q;
  if (count > 0) return;

  try {
    await sendReplyNotDeliveredEmail({ to: fromEmail, reason, baseUrl: getBaseUrl() });
    await finish(logId, { notice_sent_at: new Date().toISOString() });
  } catch (err) {
    console.error("inbound email: notice failed:", err);
  }
}

/**
 * Process one stored message. Safe to call twice for the same key: the second
 * call returns { status: "duplicate" } without doing anything.
 *
 * @param {{ bucket: string, key: string, recipients?: string[] }} input
 */
export async function processInboundEmail({ bucket, key, recipients = [] }) {
  const { data: claimed, error: claimError } = await supabase
    .from("chat_inbound_emails")
    .insert({ s3_key: key, status: "processing" })
    .select("id")
    .single();
  if (claimError) {
    if (claimError.code === "23505") return { status: "duplicate" };
    console.error("inbound email: claim failed:", claimError);
    return { status: "error" };
  }
  const logId = claimed.id;

  try {
    const object = await mailBucketClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const parsed = await simpleParser(Buffer.from(await object.Body.transformToByteArray()));

    const fromEmail = String(parsed.from?.value?.[0]?.address ?? "").trim().toLowerCase();
    const base = { from_email: fromEmail || null, message_id_header: parsed.messageId || null };

    if (
      /^fail$/i.test(headerText(parsed, "x-ses-spam-verdict").trim()) ||
      /^fail$/i.test(headerText(parsed, "x-ses-virus-verdict").trim())
    ) {
      await finish(logId, { ...base, status: "spam" });
      return { status: "spam" };
    }
    if (isAutomatic(parsed)) {
      await finish(logId, { ...base, status: "auto_reply" });
      return { status: "auto_reply" };
    }
    if (!fromEmail || !authenticated(parsed, fromEmail)) {
      await finish(logId, { ...base, status: "unauthenticated" });
      return { status: "unauthenticated" };
    }

    const found = findReplyToken(parsed, recipients);
    const notice = async (status, reason, threadId = null) => {
      await finish(logId, { ...base, status, reason, thread_id: threadId });
      await maybeSendNotice({ logId, fromEmail, threadId, reason: status });
      return { status, reason };
    };

    if (!found) return notice("unknown_address", "no reply token for this environment");

    const { data: participant } = await supabase
      .from("chat_participants")
      .select("thread_id, user_id, users:user_id(email, name, company_name, deleted_at), chat_threads:thread_id(deleted_at)")
      .eq("reply_token_hash", hashReplyToken(found.token))
      .maybeSingle();
    if (!participant || participant.users?.deleted_at) {
      return notice("unknown_address", "token matches no participant");
    }
    const { thread_id: threadId, user_id: userId } = participant;
    base.to_address = found.address;
    base.user_id = userId;
    if (participant.chat_threads?.deleted_at) {
      return notice("rejected", "conversation deleted", threadId);
    }

    // Who may speak for this participant.
    const { data: alertEmail } = await supabase.rpc("fn_chat_alert_email", {
      p_thread_id: threadId,
      p_user_id: userId,
    });
    const allowed = [participant.users?.email, alertEmail]
      .map((e) => String(e ?? "").trim().toLowerCase())
      .filter(Boolean);
    // Off production every alert is redirected to a tester's inbox, so the reply
    // comes from there. Never honoured on the real site.
    const testers = outreachEnabled()
      ? []
      : String(process.env.CHAT_INBOUND_TEST_SENDERS ?? "")
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
    const fromDomain = domainOf(fromEmail);
    const sameCompany =
      !SHARED_DOMAINS.has(fromDomain) && allowed.some((e) => domainOf(e) === fromDomain);
    if (!allowed.includes(fromEmail) && !testers.includes(fromEmail) && !sameCompany) {
      return notice("wrong_sender", "from address is not this participant", threadId);
    }
    if (/^\s*(fwd?|fw)\s*:/i.test(String(parsed.subject ?? ""))) {
      return notice("wrong_sender", "forwarded", threadId);
    }

    const extracted = extractReplyText({
      text: parsed.text,
      html: typeof parsed.html === "string" ? parsed.html : "",
      senderName: participant.users?.name,
      senderCompany: participant.users?.company_name,
      fromName: parsed.from?.value?.[0]?.name,
    });
    const { text: redacted, reasons } = redactChatText(extracted);
    let body = redacted.trim();
    if (!body || body === "[removed]") {
      return notice("empty", reasons.length ? "only removed content" : "no new text", threadId);
    }
    if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY - 1)}…`;

    const { data: sent, error: sendError } = await supabase.rpc("rpc_send_chat_message", {
      p_user_id: userId,
      p_thread_id: threadId,
      p_body: body,
    });
    if (sendError || !sent?.messageId) {
      console.error("inbound email: send rpc refused:", sendError);
      return notice("rejected", sendError?.message?.slice(0, 200) ?? "send failed", threadId);
    }

    await supabase
      .from("chat_messages")
      .update({ metadata: { via: "email" } })
      .eq("id", sent.messageId);

    if (reasons.length > 0) {
      await supabase.rpc("rpc_log_chat_moderation_event", {
        p_user_id: userId,
        p_action: "flag",
        p_reasons: [...reasons, "redacted_from_email"],
        p_body: extracted,
        p_thread_id: threadId,
        p_message_id: sent.messageId,
        p_listing_id: sent.listingId ?? null,
      });
    }

    await finish(logId, { ...base, status: "posted", thread_id: threadId, chat_message_id: sent.messageId });

    await notifyNewChatMessage({ threadId, senderId: userId, baseUrl: getBaseUrl(), via: "email" });
    return { status: "posted", threadId, messageId: sent.messageId };
  } catch (err) {
    console.error("inbound email: processing failed:", err);
    await finish(logId, { status: "error", reason: String(err?.message ?? err).slice(0, 200) });
    return { status: "error" };
  }
}
