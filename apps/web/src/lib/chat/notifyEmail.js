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
 * Every send is logged to chat_email_log with the provider's message id. The next alert
 * in the same thread, to the same person, carries those ids as References and In-Reply-To,
 * so Gmail, Outlook and Apple Mail stack the whole conversation in one email thread. SES
 * assigns its own Message-ID (<id@email.amazonses.com>), which is why the ids are read
 * back from the log instead of being chosen here.
 */
import supabase from "@/lib/supabase";
import { sendChatMessageEmail } from "@/lib/email";
import { mintChatAccessToken } from "@/lib/chat/accessToken";
import { ensureReplyAddress } from "@/lib/chat/replyAddress";

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
      return;
    }
    if (!data?.recipientEmail) return;

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
    });

    if (sent && !sent.suppressed) {
      const { error: logError } = await supabase.from("chat_email_log").insert({
        thread_id: data.threadId,
        recipient_id: data.recipientId,
        to_email: data.recipientEmail,
        provider: sent.provider,
        provider_message_id: sent.messageId,
      });
      if (logError) console.error("notifyNewChatMessage: log insert failed:", logError);
    }
  } catch (err) {
    // The message is already delivered in-app; a notification failure must stay silent.
    console.error("notifyNewChatMessage failed:", err);
  }
}
