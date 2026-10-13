/*
 * The two checks every chat send path runs before and around the RPC:
 * content screening on the way in, rate-limit translation on the way out.
 *
 * Kept separate from moderation.js so that file stays a pure, testable set of
 * detectors with no imports, and separate from the routes so the inquiry,
 * reply and attachment paths cannot drift apart on policy.
 */
import supabase from "@/lib/supabase";
import { screenChatText, confirmMessage, CONTACT_REASONS } from "@/lib/chat/moderation";

export const CHAT_CONFIRM_SEND_CODE = "CONFIRM_SEND";
const CONFIRMED_REASON = "confirmed_in_app";

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
 * Three outcomes:
 *
 * - blocked: abuse, fraud or phishing. Recorded here (there will be no message
 *   row) and refused with copy for the sender.
 * - needsConfirmation: only contact details or a move-elsewhere request
 *   (CONTACT_REASONS) and the sender has not yet confirmed. Not recorded, since
 *   nothing was sent; the route answers 409 CONFIRM_SEND and the composer asks
 *   "send anyway?" (Wyatt, 2026-10-12). The same message sent again with
 *   confirmed: true comes back as flagged with "confirmed_in_app" added.
 * - flagged (or clean): allowed through. The sender is told nothing about a
 *   flag, so someone probing for what gets through learns nothing. Flags are
 *   NOT recorded here: the route calls recordFlaggedSend after the post so the
 *   event carries the message id and the admin Conversations view can pin it
 *   to the message.
 *
 * @returns {Promise<
 *   {blocked: true, message: string}
 *   | {blocked: false, needsConfirmation: true, reasons: string[], message: string}
 *   | {blocked: false, flagged: boolean, reasons: string[]}
 * >}
 */
export async function screenOutgoingChat({
  userId,
  body,
  threadId = null,
  listingId = null,
  confirmed = false,
}) {
  const verdict = screenChatText(body);

  if (verdict.action === "block") {
    const contactOnly = verdict.reasons.every((r) => CONTACT_REASONS.has(r));
    if (contactOnly) {
      if (!confirmed) {
        return {
          blocked: false,
          needsConfirmation: true,
          reasons: verdict.reasons,
          message: confirmMessage(verdict.reasons),
        };
      }
      return { blocked: false, flagged: true, reasons: [...verdict.reasons, CONFIRMED_REASON] };
    }
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
    return { blocked: false, flagged: true, reasons: verdict.reasons };
  }

  return { blocked: false, flagged: false, reasons: [] };
}

/**
 * Record a flag on a message that was posted. Called by the send routes after
 * the RPC returns the message id, for both the silent flag tier and the
 * confirmed contact-details case.
 */
export async function recordFlaggedSend({ userId, threadId, messageId, listingId = null, reasons, body }) {
  await logModeration({
    userId,
    action: "flag",
    reasons,
    body,
    threadId,
    messageId,
    listingId,
  });
}

/**
 * Record an attachment scan result.
 *
 * Same table as text screening, with the file names standing in for the body
 * excerpt: a reviewer needs to know which upload was refused, and the file
 * itself is in R2 under the thread's prefix.
 */
export async function recordAttachmentScan({
  userId,
  threadId,
  blocked,
  reasons,
  fileNames = [],
}) {
  await logModeration({
    userId,
    action: blocked ? "block" : "flag",
    reasons,
    body: `[attachment] ${fileNames.join(", ")}`,
    threadId,
  });
}

export const CHAT_PASSWORD_REQUIRED_CODE = "PASSWORD_REQUIRED";

export const CHAT_PASSWORD_REQUIRED_MESSAGE =
  "Set a password to reply. This keeps your conversations yours, and lets you get back in without an email link.";

/**
 * Can this account send a message yet?
 *
 * Reading a thread from a magic link needs no credentials: the link was emailed
 * to the address on the account, so following it proves control of the inbox.
 * Sending is where identity starts to matter, because the reply is attributed to
 * a named landlord and the student will act on it. An account that has never set
 * a password and is not a Google account has to set one first
 * (Wyatt, 2026-10-03).
 *
 * This is why relaxing landlordCanChat to "we have an email address" is safe.
 * Reachability and participation are separate gates, and this is the second one.
 *
 * Enforced server-side rather than in the composer, because the composer is not
 * where a crafted request arrives.
 *
 * @returns {Promise<{ok: true} | {ok: false, reason: "password_required"}>}
 */
export async function assertSenderCanSend(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("password_hash, google_account")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // Fail open on a read failure: a Supabase blip must not silence a landlord
    // who does have a password. The rate limiter and the content screen still
    // apply, so this is not the only thing standing in the way.
    console.error("chat send eligibility check failed:", error);
    return { ok: true };
  }

  if (!data) return { ok: true };
  if (data.google_account === true) return { ok: true };
  if (data.password_hash) return { ok: true };
  return { ok: false, reason: "password_required" };
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
