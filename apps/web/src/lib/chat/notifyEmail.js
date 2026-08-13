/*
 * Email notification for a new in-app chat message.
 *
 * Called from the two chat send routes inside next/server's after(), so the sender's request
 * returns as soon as the message is stored — the recipient lookup and SMTP round trip happen
 * afterwards and never slow down or fail the send.
 *
 * Whether an email is warranted at all is decided in the database by
 * rpc_chat_notification_recipient, which enforces the recipient's preference, the
 * actively-reading guard, and the re-notify cooldown, and atomically stamps last_notified_at.
 * A null return means "no email" — that is the normal case, not an error.
 */
import supabase from "@/lib/supabase";
import { sendChatMessageEmail } from "@/lib/email";

export async function notifyNewChatMessage({ threadId, senderId, baseUrl }) {
  try {
    const { data, error } = await supabase.rpc("rpc_chat_notification_recipient", {
      p_thread_id: threadId,
      p_sender_id: senderId,
    });

    if (error) {
      console.error("notifyNewChatMessage: recipient lookup failed:", error);
      return;
    }
    if (!data?.recipientEmail) return;

    await sendChatMessageEmail({
      to: data.recipientEmail,
      recipientName: data.recipientName,
      senderName: data.senderName,
      // The listing is the thread's identity for both sides; subject is the fallback for
      // threads with no listing attached.
      listingLabel: data.listingTitle || data.listingAddress || data.subject,
      messageBody: data.messageBody,
      recipientIsInterestedUser: data.recipientIsInterestedUser,
      threadUrl: `${baseUrl}/messages?thread=${data.threadId}`,
    });
  } catch (err) {
    // The message is already delivered in-app; a notification failure must stay silent.
    console.error("notifyNewChatMessage failed:", err);
  }
}
