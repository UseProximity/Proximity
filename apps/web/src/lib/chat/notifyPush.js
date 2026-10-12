/*
 * Push notification for a new in-app chat message.
 *
 * Called from the chat send routes inside next/server's after(), next to the email
 * notification (notifyEmail.js), so the sender's request has already returned. A failure
 * here is logged and swallowed: the message is already delivered in-app.
 *
 * Deliberately independent of rpc_chat_notification_recipient. That function decides
 * email (the email preference, the reading window, the re-notify cooldown) and stamps
 * last_notified_at as it runs, so reusing it would both suppress pushes for the wrong
 * reasons and consume the email's state. Push has no cooldown of its own yet: every
 * message notifies the other participant once.
 *
 * The recipient is read from chat_participants, never taken from the request. The
 * notification reads like a chat app's: the sender's name as the title and the message
 * text as the body, both loaded here from the database (users.name and the exact
 * message that triggered this push, by id), never supplied by the caller. They live only in the
 * title and body. `data` carries only what the app needs to open the thread, so the
 * name and text are not part of the payload the app reads. Nothing else is included:
 * no listing, address, property detail or file name. A message with no text (an
 * attachment on its own) gets a fixed line, and an unresolvable name falls back to a
 * generic title. sendPushNotification fans out to all of that user's devices, so one
 * call here is one notification per device and never more than one per recipient.
 */
import supabase from "@/lib/supabase";
import { sendPushNotification } from "@/lib/push";

const FALLBACK_TITLE = "New message";
const FALLBACK_BODY = "You have a new message";
const ATTACHMENT_BODY = "\u{1F4CE} Sent an attachment";
// Notification bodies are shown in a few lines at most; the chat keeps the full text.
const BODY_MAX_CHARS = 140;

function truncateForNotification(text) {
  // Newlines and runs of spaces collapse so the preview reads as one line.
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length <= BODY_MAX_CHARS) return chars.join("");
  return `${chars.slice(0, BODY_MAX_CHARS - 3).join("").trimEnd()}...`;
}

// Title and body for the notification. Any lookup failure degrades to the generic
// wording rather than blocking the push.
async function loadNotificationText(threadId, senderId, messageId) {
  const [{ data: sender, error: senderError }, { data: message, error: messageError }] =
    await Promise.all([
      supabase.from("users").select("name").eq("id", senderId).maybeSingle(),
      // No id (it should always be there) means no text, not a guess at one.
      !messageId
        ? Promise.resolve({ data: null, error: null })
        : supabase
            .from("chat_messages")
            .select("body, message_type")
            .eq("id", messageId)
            // The id comes from the send route, but the row must still be this sender's
            // message in this thread, so a stray id can never surface someone else's text.
            .eq("thread_id", threadId)
            .eq("sender_id", senderId)
            .is("deleted_at", null)
            .maybeSingle(),
    ]);
  if (senderError || messageError) {
    console.error(
      "notifyNewChatMessagePush: content lookup failed:",
      (senderError || messageError).message
    );
  }

  const name = typeof sender?.name === "string" ? sender.name.trim() : "";
  const text = typeof message?.body === "string" ? message.body.trim() : "";
  let body = FALLBACK_BODY;
  if (text) body = truncateForNotification(text);
  else if (message?.message_type === "attachment") body = ATTACHMENT_BODY;

  return { title: name || FALLBACK_TITLE, body };
}

export async function notifyNewChatMessagePush({ threadId, senderId, messageId }) {
  try {
    if (!threadId || !senderId) return;

    const { data: participants, error } = await supabase
      .from("chat_participants")
      .select("user_id, joined_at")
      .eq("thread_id", threadId);
    if (error) {
      console.error("notifyNewChatMessagePush: participant lookup failed:", error.message);
      return;
    }

    // The sender must belong to the thread, or this call does not describe a real send.
    if (!participants?.some((row) => row.user_id === senderId)) return;

    const otherIds = participants
      .filter((row) => row.user_id !== senderId)
      .sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)))
      .map((row) => row.user_id);
    if (otherIds.length === 0) return;

    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id")
      .in("id", otherIds)
      .is("deleted_at", null)
      .not("is_system", "is", true);
    if (usersError) {
      console.error("notifyNewChatMessagePush: recipient lookup failed:", usersError.message);
      return;
    }

    // Direct threads have exactly one other participant. Taking the first eligible one
    // (by join order) matches the email notification and keeps this at one recipient.
    const eligible = new Set((users ?? []).map((row) => row.id));
    const recipientId = otherIds.find((id) => eligible.has(id));
    if (!recipientId) return;

    const { title, body } = await loadNotificationText(threadId, senderId, messageId);
    const result = await sendPushNotification(recipientId, {
      title,
      body,
      data: { threadId, route: `/chat/${threadId}` },
    });

    // Counts only: ticket errors can quote the device token.
    if (result?.errors?.length) {
      console.error(`notifyNewChatMessagePush: ${result.errors.length} delivery error(s)`);
    }
  } catch (err) {
    console.error("notifyNewChatMessagePush failed:", err?.message);
  }
}
