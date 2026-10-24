/*
 * Email notification for a new in-app chat message.
 *
 * Called from the chat send routes inside next/server's after(), so the sender's request
 * returns as soon as the message is stored. The recipient lookup and the send happen
 * afterwards and never slow down or fail the send.
 *
 * One email per burst (Wyatt, 2026-10-12): each message waits ALERT_QUIET_MS for follow-ups
 * before asking for an alert, and passes its own id. The database then declines if the sender
 * has posted something newer (that message's own wait will send, covering the whole run) or
 * if the recipient has read the thread in the meantime. Three quick messages start three
 * waits and produce one email listing all three. Email replies pass quietMs 0: a reply is a
 * complete thought and should relay at once. Vercel keeps the function alive for after()
 * well past 30 seconds, so the wait costs idle time only.
 *
 * Whether an email is warranted at all is decided in the database by
 * rpc_chat_notification_recipient: every new message is emailed unless the recipient has
 * message emails turned off or their address is suppressed. Every alert carries everything
 * the recipient has not read yet (sending counts as reading, so this is the run of messages
 * they have not answered), and stamps last_notified_at for the record. A null return means
 * "no email".
 *
 * `via` is how the sender wrote: "app" (the default) or "email". It is recorded on the
 * sender's participant row as email_mode.
 *
 * Every attempt is logged to chat_email_log: what was sent, to whom, for which message,
 * and its status. A send that fails outright is logged as 'failed' and the team is emailed
 * at once (lib/chat/deliveryAlerts.js); SES then reports delivery, bounces and spam
 * complaints for the rest through /api/ses/events (Wyatt, 2026-10-23). The next alert
 * in the same thread, to the same person, carries those ids as References and In-Reply-To,
 * so Gmail, Outlook and Apple Mail stack the whole conversation in one email thread. SES
 * assigns its own Message-ID (<id@email.amazonses.com>), which is why the ids are read
 * back from the log instead of being chosen here.
 */
import supabase from "@/lib/supabase";
import { sendChatMessageEmail } from "@/lib/email";
import { mintChatAccessToken } from "@/lib/chat/accessToken";
import { ensureReplyAddress } from "@/lib/chat/replyAddress";
import { alertTeam } from "@/lib/chat/deliveryAlerts";

const SES_MESSAGE_ID_DOMAIN = "email.amazonses.com";
const MAX_REFERENCES = 20;

function messageIdHeader(provider, id) {
  const raw = String(id ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("<")) return raw;
  return provider === "ses" ? `<${raw}@${SES_MESSAGE_ID_DOMAIN}>` : `<${raw}>`;
}

/** Message-IDs of the alerts already sent to this person in this thread, oldest first. */
async function earlierAlertIds({ threadId, recipientId }) {
  const { data, error } = await supabase
    .from("chat_email_log")
    .select("provider, provider_message_id")
    .eq("thread_id", threadId)
    .eq("recipient_id", recipientId)
    .order("created_at", { ascending: false })
    .limit(MAX_REFERENCES);
  if (error) {
    console.error("notifyNewChatMessage: email log lookup failed:", error);
    return [];
  }
  return (data ?? [])
    .map((row) => messageIdHeader(row.provider, row.provider_message_id))
    .filter(Boolean)
    .reverse();
}

/** Is this alert going to the recipient's own account email (not a routed contact)? */
async function isAccountInbox(userId, email) {
  const { data, error } = await supabase.from("users").select("email").eq("id", userId).maybeSingle();
  if (error) {
    console.error("notifyNewChatMessage: account email lookup failed:", error);
    return false;
  }
  const norm = (v) => String(v ?? "").trim().toLowerCase();
  return Boolean(data?.email) && norm(data.email) === norm(email);
}

/** How long a message waits for follow-ups before its alert goes out. */
export const ALERT_QUIET_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function notifyNewChatMessage({
  threadId,
  senderId,
  messageId = null,
  baseUrl,
  via = "app",
  quietMs = ALERT_QUIET_MS,
  // A staging tester's chosen test inbox: the x-staging-email-to header value,
  // captured by the route before after() (see stagingEmailHeader in outreach.js).
  testEmailTo = null,
}) {
  try {
    // Without a message id there is nothing to dedupe against, so no wait.
    if (messageId && quietMs > 0) await sleep(quietMs);

    const { data, error } = await supabase.rpc("rpc_chat_notification_recipient", {
      p_thread_id: threadId,
      p_sender_id: senderId,
      p_sender_via: via,
      p_message_id: messageId,
    });

    if (error) {
      console.error("notifyNewChatMessage: recipient lookup failed:", error);
      await alertTeam({
        subject: "a message alert could not be prepared",
        intro: "The database lookup for who to email failed, so no alert went out for this message.",
        facts: [["Conversation", threadId], ["Message", messageId], ["Error", error.message]],
        action: "Check the conversation in the admin dashboard and make sure the other side has seen the message.",
      });
      return;
    }
    if (!data?.recipientEmail) return;

    await deliverAlert(data, { baseUrl, testEmailTo, messageId });
  } catch (err) {
    // The message is already delivered in-app, so the sender never sees this.
    // The team does (deliverAlert reports its own failures; this is anything else).
    console.error("notifyNewChatMessage failed:", err);
    await alertTeam({
      subject: "a message alert crashed",
      intro: "Something failed while sending the email alert for this message.",
      facts: [["Conversation", threadId], ["Message", messageId], ["Error", String(err?.message ?? err)]],
      action: "Check the conversation in the admin dashboard and make sure the other side has seen the message.",
    });
  }
}

async function logAttempt(row) {
  const { error } = await supabase.from("chat_email_log").insert({ ...row, status_at: new Date().toISOString() });
  if (error) {
    console.error("notifyNewChatMessage: log insert failed:", error);
    await alertTeam({
      subject: "a chat email was not recorded",
      intro: `An alert ${row.status === "failed" ? "failed" : "was sent"} but the delivery log could not be written, so delivery will not be tracked for it.`,
      facts: [["Conversation", row.thread_id], ["To", row.to_email], ["Error", error.message]],
    });
  }
}

/*
 * Send one alert for a recipient row from rpc_chat_notification_recipient and log it.
 * Returns the send result, or null when nothing was sent. Never throws: a failed
 * send is logged as 'failed' and reported to the team.
 */
async function deliverAlert(data, { baseUrl, reminder = false, testEmailTo = null, messageId = null }) {
  const attempt = {
    thread_id: data.threadId,
    recipient_id: data.recipientId,
    to_email: data.recipientEmail,
    kind: reminder ? "reminder" : "alert",
    message_id: messageId,
  };
  try {
    return await sendAlert(data, { baseUrl, reminder, testEmailTo, attempt });
  } catch (err) {
    console.error("deliverAlert: send failed:", err);
    const detail = String(err?.message ?? err).slice(0, 500);
    await logAttempt({ ...attempt, provider: null, status: "failed", status_detail: detail });
    await alertTeam({
      subject: `a ${attempt.kind === "reminder" ? "reply reminder" : "message alert"} could not be sent`,
      intro: "Both Amazon SES and the Gmail fallback refused the email. The message is in the app, but the recipient was not emailed.",
      facts: [
        ["To", data.recipientEmail],
        ["Conversation", data.threadId],
        ["Listing", data.listingTitle || data.listingAddress || data.subject],
        ["Error", detail],
      ],
      action: "Email or call the recipient so they know a message is waiting, then check the email settings in Vercel.",
    });
    return null;
  }
}

async function sendAlert(data, { baseUrl, reminder, testEmailTo, attempt }) {
  // Magic link: raw token only in the URL. Mint failure falls back to a login-gated
  // /messages deep link so the notification still arrives.
  //
  // Only the account's own inbox gets one. A magic link signs in as the account, so an
  // alert routed to a lease or listing contact (a shared leasing office inbox, say) would
  // hand everyone reading that inbox the landlord's whole account. Contact addresses are
  // alert routes, never accounts: they get the login-gated link and can reply by email.
  const rawToken = (await isAccountInbox(data.recipientId, data.recipientEmail))
    ? await mintChatAccessToken({ userId: data.recipientId, threadId: data.threadId })
    : null;
  const threadUrl = rawToken
    ? `${baseUrl}/chat-link?token=${encodeURIComponent(rawToken)}&t=${encodeURIComponent(data.threadId)}`
    : `${baseUrl}/messages?thread=${data.threadId}`;

  const [replyTo, references] = await Promise.all([
    ensureReplyAddress({ threadId: data.threadId, userId: data.recipientId }),
    earlierAlertIds({ threadId: data.threadId, recipientId: data.recipientId }),
  ]);

  const sent = await sendChatMessageEmail({
    to: data.recipientEmail,
    senderName: data.senderName,
    senderCompany: data.senderCompany,
    listingTitle: data.listingTitle,
    listingAddress: data.listingAddress,
    subject: data.subject,
    messages: data.messages,
    earlierCount: data.earlierCount,
    recipientIsInterestedUser: data.recipientIsInterestedUser,
    threadUrl,
    replyTo,
    threadRef: `thread.${data.threadId}.${data.recipientId}`,
    references,
    reminder,
    threadId: data.threadId,
    recipientId: data.recipientId,
    testEmailTo,
  });

  if (sent && !sent.suppressed) {
    await logAttempt({ ...attempt, provider: sent.provider, provider_message_id: sent.messageId, status: "sent", status_detail: sent.sesError ? `SES failed, sent through Gmail: ${sent.sesError}` : null });
  }
  return sent ?? null;
}

/*
 * Reply reminder (Wyatt, 2026-10-16): sent once by the daily check-in cron when a
 * message has gone unanswered for 3 days. `senderId` is the person who is waiting;
 * the reminder goes to the other side, through the same routing, opt-out and
 * suppression rules as a normal alert, and stacks into the same email thread.
 *
 * The RPC also sets the sender's email_mode from `via`. A reminder is not a send,
 * so the sender's current mode is passed back unchanged.
 *
 * Returns "sent", "suppressed" (off production), "no_recipient" or "failed".
 */
export async function sendReplyReminder({ threadId, senderId, baseUrl }) {
  try {
    const { data: senderRow } = await supabase
      .from("chat_participants")
      .select("email_mode")
      .eq("thread_id", threadId)
      .eq("user_id", senderId)
      .maybeSingle();

    const { data, error } = await supabase.rpc("rpc_chat_notification_recipient", {
      p_thread_id: threadId,
      p_sender_id: senderId,
      p_sender_via: senderRow?.email_mode ? "email" : "app",
      p_message_id: null,
    });
    if (error) {
      console.error("sendReplyReminder: recipient lookup failed:", error);
      return "failed";
    }
    if (!data?.recipientEmail) return "no_recipient";

    const sent = await deliverAlert(data, { baseUrl, reminder: true });
    if (!sent) return "failed";
    return sent.suppressed ? "suppressed" : "sent";
  } catch (err) {
    console.error("sendReplyReminder failed:", err);
    return "failed";
  }
}
