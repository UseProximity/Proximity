/*
 * Private reply addresses for chat alert emails.
 *
 * Every alert carries a Reply-To like reply+<token>@reply.useproximity.org. The
 * token identifies one person in one thread, so a reply can be filed into the
 * right conversation as the right sender without anyone's real address being
 * exposed to the other side.
 *
 * The token is an HMAC of (thread, user) under CHAT_REPLY_SECRET, so the same
 * person always gets the same address for a thread and the server can rebuild
 * it at any time. Only its SHA-256 lands in the database
 * (chat_participants.reply_token_hash), which is what an inbound reply is looked
 * up by. Possessing the address is not enough to post: the inbound side also
 * checks the reply came from that person's own mailbox.
 *
 * Lowercase hex because some mail servers lowercase the local part.
 */
import { createHash, createHmac } from "crypto";
import supabase from "@/lib/supabase";
import { appEnv } from "@/lib/appEnv";

const REPLY_DOMAINS = {
  production: "reply.useproximity.org",
  staging: "reply-staging.useproximity.org",
  development: "reply-dev.useproximity.org",
};

export function replyDomain() {
  return process.env.CHAT_REPLY_DOMAIN || REPLY_DOMAINS[appEnv()] || REPLY_DOMAINS.development;
}

export function replyToken({ threadId, userId }) {
  const secret = process.env.CHAT_REPLY_SECRET;
  if (!secret || !threadId || !userId) return null;
  return createHmac("sha256", secret).update(`${threadId}:${userId}`).digest("hex").slice(0, 32);
}

export function hashReplyToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

/**
 * The Reply-To for this person in this thread, recording its hash so the reply
 * can be matched. Null when replies by email are not configured or the hash
 * could not be saved, in which case the alert goes out without one.
 */
export async function ensureReplyAddress({ threadId, userId }) {
  const token = replyToken({ threadId, userId });
  if (!token) return null;

  const { error } = await supabase
    .from("chat_participants")
    .update({ reply_token_hash: hashReplyToken(token) })
    .eq("thread_id", threadId)
    .eq("user_id", userId);
  if (error) {
    console.error("ensureReplyAddress failed:", error);
    return null;
  }
  return `reply+${token}@${replyDomain()}`;
}
