/*
 * The two checks every chat send path runs before and around the RPC:
 * content screening on the way in, rate-limit translation on the way out.
 *
 * Kept separate from moderation.js so that file stays a pure, testable set of
 * detectors with no imports, and separate from the routes so the inquiry,
 * reply and attachment paths cannot drift apart on policy.
 */
import supabase from "@/lib/supabase";
import { screenChatText } from "@/lib/chat/moderation";

/*
 * Log the decision. Never allowed to break a send: a screening record is
 * worth less than the message it is about, so a failed insert is swallowed
 * rather than turning a working conversation into a 500.
 */
async function logModeration({
  userId,
  action,
  reasons,
  body,
  threadId = null,
  messageId = null,
  listingId = null,
}) {
  try {
    await supabase.rpc("rpc_log_chat_moderation_event", {
      p_user_id: userId,
      p_action: action,
      p_reasons: reasons,
      p_body: body,
      p_thread_id: threadId,
      p_message_id: messageId,
      p_listing_id: listingId,
    });
  } catch (error) {
    console.error("chat moderation log failed:", error);
  }
}

/**
 * Screen a body before sending.
 *
 * A block is recorded and refused. A flag is recorded and allowed through, and
 * the sender is told nothing: the whole point of the flag tier is that someone
 * probing for what gets through learns nothing from the response.
 *
 * @returns {Promise<{blocked: true, message: string} | {blocked: false, flagged: boolean, reasons: string[]}>}
 */
export async function screenOutgoingChat({
  userId,
  body,
  threadId = null,
  listingId = null,
}) {
  const verdict = screenChatText(body);

  if (verdict.action === "block") {
    await logModeration({
      userId,
      action: "block",
      reasons: verdict.reasons,
      body,
      threadId,
      listingId,
    });
    return { blocked: true, message: verdict.message };
  }

  if (verdict.action === "flag") {
    await logModeration({
      userId,
      action: "flag",
      reasons: verdict.reasons,
      body,
      threadId,
      listingId,
    });
    return { blocked: false, flagged: true, reasons: verdict.reasons };
  }

  return { blocked: false, flagged: false, reasons: [] };
}

/*
 * fn_chat_assert_send_rate raises with a 'chat rate limit: ' prefix. Matching
 * on the prefix keeps the specific ceiling that tripped out of the response,
 * so the limits are not published to whoever is testing them.
 */
export function isChatRateLimitError(error) {
  return typeof error?.message === "string"
    && error.message.startsWith("chat rate limit:");
}

export const CHAT_RATE_LIMIT_MESSAGE =
  "You have sent a lot of messages in a short time. Try again shortly.";
