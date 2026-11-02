/*
 * Reply addresses for the agents' emails (Wyatt, 2026-11-01); the inbound
 * side is replyEmail.js. Kept apart, like questionTokens.js, so the senders
 * can stamp an address without importing the inbound handlers.
 *
 *   reply+t<tour><sig>    a landlord's tour request email
 *   reply+p<thread><sig>  a student's email from Proxy
 */
import { createHmac } from "crypto";
import { replyDomain } from "@/lib/chat/replyAddress";

export const hex = (id) => String(id ?? "").replace(/-/g, "").toLowerCase();
export const uuid = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export function sign(kind, id, recipientId) {
  const secret = process.env.CHAT_REPLY_SECRET;
  if (!secret || !id || !recipientId) return null;
  return createHmac("sha256", secret).update(`${kind}:${id}:${recipientId}`).digest("hex").slice(0, 16);
}

function address(kind, id, recipientId) {
  const sig = sign(kind, id, recipientId);
  return sig ? `reply+${kind}${hex(id)}${sig}@${replyDomain()}` : null;
}

/* The address a landlord replies to on a tour request email. */
export const tourReplyAddress = ({ tourId, landlordId }) => address("t", tourId, landlordId);

/*
 * The address a student replies to on Proxy's emails. Bound to who it was
 * sent to: the account, or for a visitor the confirmed email itself.
 */
export const proxyReplyAddress = ({ threadId, recipientKey }) => address("p", threadId, recipientKey);
