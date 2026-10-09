/*
 * Email notification for a new in-app chat message.
 *
 * Called from the chat send routes inside next/server's after(), so the sender's request
 * returns as soon as the message is stored. The recipient lookup and the send happen
 * afterwards and never slow down or fail the send.
 *
 * Whether an email is warranted at all is decided in the database by
 * rpc_chat_notification_recipient, which enforces the recipient's preference, the
 * actively-reading guard and the re-notify cooldown (both skipped while the recipient is
 * in email mode), skips suppressed addresses, and atomically stamps last_notified_at.
 * A null return means "no email". That is the normal case, not an error.
 *
 * `via` is how the sender wrote: "app" (the default) or "email". It sets the sender's own
 * email mode, so answering in the app goes back to normal batched alerts.
 *
 * Every send is logged to chat_email_log with the provider's message id.
 */
import supabase from "@/lib/supabase";
import { sendChatMessageEmail } from "@/lib/email";
import { mintChatAccessToken } from "@/lib/chat/accessToken";
import { ensureReplyAddress } from "@/lib/chat/replyAddress";

export async function notifyNewChatMessage({ threadId, senderId, baseUrl, via = "app" }) {
  try {
    const { data, error } = await supabase.rpc("rpc_chat_notification_recipient", {
      p_thread_id: threadId,
      p_sender_id: senderId,
      p_sender_via: via,
    });

    if (error) {
      console.error("notifyNewChatMessage: recipient lookup failed:", error);
      return;
    }
    if (!data?.recipientEmail) return;

    // Magic link: raw token only in the URL. Mint failure falls back to a login-gated
    // /messages deep link so the notification still arrives.
    const rawToken = await mintChatAccessToken({
      userId: data.recipientId,
      threadId: data.threadId,
    });
    const threadUrl = rawToken
      ? `${baseUrl}/chat-link?token=${encodeURIComponent(rawToken)}&t=${encodeURIComponent(data.threadId)}`
      : `${baseUrl}/messages?thread=${data.threadId}`;

    const replyTo = await ensureReplyAddress({
      threadId: data.threadId,
      userId: data.recipientId,
    });

    const sent = await sendChatMessageEmail({
      to: data.recipientEmail,
      recipientName: data.recipientName,
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
