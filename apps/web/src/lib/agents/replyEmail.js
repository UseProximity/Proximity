/*
 * Email replies into the agents' conversations (Wyatt, 2026-11-01), beside
 * the landlord question replies in questionEmail.js:
 *
 *   reply+t<tour><sig>@<reply domain>   a landlord answering a tour request
 *                                       email. It is a message to the student,
 *                                       exactly as if written in the app, and
 *                                       opens their direct chat.
 *   reply+p<thread><sig>@<reply domain> a student answering one of Proxy's
 *                                       emails. It is a message to Proxy,
 *                                       exactly as if typed in the chat, and
 *                                       Proxy's reply is emailed back.
 *
 * <tour> and <thread> are the ids without dashes; <sig> is an HMAC of the id
 * and its recipient under CHAT_REPLY_SECRET, so an address can't be guessed or
 * pointed at another conversation, and nothing new is stored. The chat's own
 * reply+<32 hex> and the questions' reply+q addresses never match these.
 *
 * Sender rules match the other replies: the recipient's own address, the same
 * company domain or an approved sender for a landlord, or (off production) a
 * listed test sender. Text is cleaned like any emailed chat reply: quoted
 * history, signatures and sign-offs are removed.
 */
import supabase from "@/lib/supabase";
import { outreachEnabled } from "@/lib/appEnv";
import { replyDomain } from "@/lib/chat/replyAddress";
import { sign, uuid, proxyReplyAddress } from "./replyTokens";
import { extractReplyText } from "@/lib/chat/emailReplyText";
import { SHARED_DOMAINS, senderDecision } from "@/lib/chat/replySenders";
import { domainOf } from "@/lib/chat/inboundAuth";
import { getBaseUrl, sendProxyStudentEmail } from "@/lib/email";
import { landlordAct } from "./tours";
import { getThread, PROXY_USER_ID } from "./threads";
import { handleStudentMessage } from "./proxy";

export { tourReplyAddress, proxyReplyAddress } from "./replyTokens";

const header = (parsed, name) => {
  const v = parsed?.headers?.get?.(name);
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => x?.text ?? x?.value?.map?.((y) => y.address).join(",") ?? "").join(",");
  return v.text ?? v.value?.map?.((y) => y.address).join(",") ?? "";
};

/* { kind: "t" | "p", id, sig, address } from whichever recipient carries one. */
export function findAgentReplyToken(parsed, recipients = []) {
  const domain = replyDomain().replace(/\./g, "\\.");
  const re = new RegExp(`reply\\+([tp])([a-f0-9]{32})([a-f0-9]{16})@${domain}`, "i");
  for (const c of [...recipients, ...["to", "cc", "delivered-to", "x-original-to"].map((h) => header(parsed, h))]) {
    const m = String(c ?? "").match(re);
    if (m) return { kind: m[1].toLowerCase(), id: uuid(m[2].toLowerCase()), sig: m[3].toLowerCase(), address: m[0].toLowerCase() };
  }
  return null;
}

const testers = () => (outreachEnabled() ? [] : String(process.env.CHAT_INBOUND_TEST_SENDERS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));

const cleanText = (parsed, { senderName = null, senderCompany = null } = {}) => extractReplyText({
  text: parsed.text, html: typeof parsed.html === "string" ? parsed.html : "",
  senderName, senderCompany, fromName: parsed.from?.value?.[0]?.name,
}).trim();

/* Route one authenticated inbound email to its handler. */
export async function handleAgentReplyEmail({ parsed, fromEmail, token, logId = null, finish = async () => {} }) {
  if (token.kind === "t") return tourReply({ parsed, fromEmail, token, logId, finish });
  return proxyReply({ parsed, fromEmail, token, logId, finish });
}

async function tourReply({ parsed, fromEmail, token, logId, finish }) {
  const { data: t } = await supabase.from("tour_requests").select("id, landlord_id, status, listing_id").eq("id", token.id).maybeSingle();
  if (!t || sign("t", t.id, t.landlord_id) !== token.sig) {
    await finish(logId, { status: "unknown_address", reason: "token matches no tour" });
    return { status: "unknown_address" };
  }
  const { data: landlord } = await supabase.from("users").select("id, email, name, company_name, deleted_at").eq("id", t.landlord_id).maybeSingle();
  const own = String(landlord?.email ?? "").trim().toLowerCase();
  const sameCompany = own && !SHARED_DOMAINS.has(domainOf(fromEmail)) && domainOf(own) === domainOf(fromEmail);
  let allowed = !landlord?.deleted_at && (fromEmail === own || testers().includes(fromEmail) || sameCompany);
  if (!allowed && landlord) allowed = (await senderDecision(supabase, landlord.id, fromEmail)) === "approved";
  if (!allowed) {
    await finish(logId, { user_id: t.landlord_id, status: "wrong_sender", reason: "from address is not this landlord" });
    return { status: "wrong_sender" };
  }
  const text = cleanText(parsed, { senderName: landlord?.name, senderCompany: landlord?.company_name });
  if (!text) {
    await finish(logId, { user_id: t.landlord_id, status: "empty", reason: "no new text" });
    return { status: "empty" };
  }
  // Exactly "Message the student": opens their direct chat, or writes in it.
  const r = await landlordAct({ tourId: t.id, landlordId: t.landlord_id, action: "message", body: text, via: "email" });
  if (r.error) {
    await finish(logId, { user_id: t.landlord_id, status: "rejected", reason: String(r.error).slice(0, 200) });
    return { status: "rejected", reason: r.error };
  }
  await finish(logId, { user_id: t.landlord_id, thread_id: r.threadId ?? null, status: "posted", reason: "tour reply to student", body_preview: text.slice(0, 2000) });
  return { status: "posted" };
}

async function proxyReply({ parsed, fromEmail, token, logId, finish }) {
  const thread = await getThread(token.id);
  if (!thread || thread.deleted_at) {
    await finish(logId, { status: "unknown_address", reason: "token matches no Proxy conversation" });
    return { status: "unknown_address" };
  }
  let student = null;
  if (thread.interested_user_id) {
    const { data } = await supabase.from("users").select("id, email, name, deleted_at").eq("id", thread.interested_user_id).maybeSingle();
    student = data;
  }
  const recipient = String(student?.email ?? thread.notify_email ?? "").trim().toLowerCase();
  const key = student?.id ?? recipient;
  if (!recipient || sign("p", thread.id, key) !== token.sig) {
    await finish(logId, { status: "unknown_address", reason: "token matches no Proxy conversation" });
    return { status: "unknown_address" };
  }
  if (student?.deleted_at || (fromEmail !== recipient && !testers().includes(fromEmail))) {
    await finish(logId, { user_id: student?.id ?? null, thread_id: thread.id, status: "wrong_sender", reason: "from address is not this student" });
    return { status: "wrong_sender" };
  }
  const text = cleanText(parsed, { senderName: student?.name });
  if (!text) {
    await finish(logId, { user_id: student?.id ?? null, thread_id: thread.id, status: "empty", reason: "no new text" });
    return { status: "empty" };
  }
  // The same as typing it in the chat.
  const result = await handleStudentMessage({ thread, body: text, userId: student?.id ?? null, visitorId: student ? null : thread.visitor_id });
  if (result.error) {
    await finish(logId, { user_id: student?.id ?? null, thread_id: thread.id, status: "rejected", reason: String(result.error).slice(0, 200) });
    return { status: "rejected", reason: result.error };
  }
  // They wrote by email, so Proxy's answer goes back by email.
  const replies = (result.messages ?? []).filter((m) => m.sender_id === PROXY_USER_ID).map((m) => m.body);
  if (replies.length) {
    const { data: listing } = await supabase.from("listings").select("title, address").eq("id", thread.listing_id).maybeSingle();
    await sendProxyStudentEmail({
      to: recipient, name: student?.name ?? null, kind: "proxy_reply", listingLabel: listing?.title || listing?.address || "a listing",
      messages: replies, threadUrl: `${getBaseUrl()}/listings/${thread.listing_id}?listingTab=contact`, threadId: thread.id,
      userId: student?.id ?? null, replyTo: proxyReplyAddress({ threadId: thread.id, recipientKey: key }),
    }).catch((err) => console.error("[proxy] email reply back failed:", err?.message ?? err));
  }
  await finish(logId, { user_id: student?.id ?? null, thread_id: thread.id, status: "posted", reason: "student email to Proxy", body_preview: text.slice(0, 2000) });
  return { status: "posted" };
}
