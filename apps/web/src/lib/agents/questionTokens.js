/*
 * The per-question reply address a landlord can answer from (PRD v3).
 * reply+q<token>@<reply domain>, token = HMAC(question, landlord) under
 * CHAT_REPLY_SECRET; only its SHA-256 is stored. Kept apart from
 * questionEmail.js so questions.js can stamp a token without importing the
 * inbound handler (which imports questions.js).
 */
import { createHmac } from "crypto";
import supabase from "@/lib/supabase";
import { replyDomain, hashReplyToken } from "@/lib/chat/replyAddress";

export function questionReplyToken({ questionId, ownerId }) {
  const secret = process.env.CHAT_REPLY_SECRET;
  if (!secret || !questionId || !ownerId) return null;
  return createHmac("sha256", secret).update(`question:${questionId}:${ownerId}`).digest("hex").slice(0, 32);
}

export function questionReplyAddress({ questionId, ownerId }) {
  const token = questionReplyToken({ questionId, ownerId });
  return token ? `reply+q${token}@${replyDomain()}` : null;
}

/* Called once a question has an owner, so its email can be answered. */
export async function stampReplyToken({ questionId, ownerId }) {
  const token = questionReplyToken({ questionId, ownerId });
  if (!token) return null;
  await supabase.from("listing_questions").update({ reply_token_hash: hashReplyToken(token) }).eq("id", questionId);
  return token;
}
