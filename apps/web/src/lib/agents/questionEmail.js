/*
 * Landlords answer Proxy's questions by email (PRD v3, milestone 3).
 *
 * Every question email carries a Reply-To of its own, reply+q<token>@<reply
 * domain>. The token is an HMAC of the question and the landlord under
 * CHAT_REPLY_SECRET; only its SHA-256 is stored (listing_questions.
 * reply_token_hash). The chat reply addresses are reply+<32 hex> with no
 * 'q', so the two never collide.
 *
 * A reply is accepted only from the landlord's own address, an approved reply
 * sender for that landlord, or (off production) a listed test sender. It is
 * never posted into a student's thread as written: the text is classified
 * (an answer, or a question back to the student), attachments are read into
 * the listing's knowledge, links are fetched and read, and the answer goes
 * through answerQuestion like an in-app one, contact details removed.
 */
import supabase from "@/lib/supabase";
import { outreachEnabled } from "@/lib/appEnv";
import { replyDomain, hashReplyToken } from "@/lib/chat/replyAddress";
import { extractReplyText } from "@/lib/chat/emailReplyText";
import { SHARED_DOMAINS, senderDecision } from "@/lib/chat/replySenders";
import { domainOf } from "@/lib/chat/inboundAuth";
import { answerQuestion, classifyReply } from "./questions";
import { ingestDocument } from "./ingest";

export { questionReplyToken, questionReplyAddress, stampReplyToken } from "./questionTokens";

export function findQuestionToken(parsed, recipients = []) {
  const domain = replyDomain().replace(/\./g, "\\.");
  const re = new RegExp(`reply\\+q([a-f0-9]{32})@${domain}`, "i");
  const header = (name) => {
    const v = parsed?.headers?.get?.(name);
    if (!v) return "";
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map((x) => x?.text ?? x?.value?.map?.((y) => y.address).join(",") ?? "").join(",");
    return v.text ?? v.value?.map?.((y) => y.address).join(",") ?? "";
  };
  const candidates = [...recipients, ...["to", "cc", "delivered-to", "x-original-to"].map(header)];
  for (const c of candidates) {
    const m = String(c ?? "").match(re);
    if (m) return { token: m[1].toLowerCase(), address: m[0].toLowerCase() };
  }
  return null;
}

/*
 * Handle one authenticated inbound email addressed to a question token.
 * Returns { status, reason } in the inbound log's vocabulary.
 */
export async function handleQuestionEmail({ parsed, fromEmail, token, attachments = [], logId = null, finish = async () => {} }) {
  const { data: q } = await supabase.from("listing_questions")
    .select("id, listing_id, owner_id, status, question, users:owner_id(email, name, company_name, deleted_at)")
    .eq("reply_token_hash", hashReplyToken(token)).maybeSingle();
  if (!q || q.users?.deleted_at) {
    await finish(logId, { status: "unknown_address", reason: "token matches no question", to_address: null });
    return { status: "unknown_address", reason: "token matches no question" };
  }
  const base = { user_id: q.owner_id };
  if (q.status !== "open") {
    await finish(logId, { ...base, status: "rejected", reason: "question already answered" });
    return { status: "rejected", reason: "question already answered" };
  }

  const ownerEmail = String(q.users?.email ?? "").trim().toLowerCase();
  const testers = outreachEnabled() ? [] : String(process.env.CHAT_INBOUND_TEST_SENDERS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const fromDomain = domainOf(fromEmail);
  const sameCompany = ownerEmail && !SHARED_DOMAINS.has(fromDomain) && domainOf(ownerEmail) === fromDomain;
  let allowed = fromEmail === ownerEmail || testers.includes(fromEmail) || sameCompany;
  if (!allowed) allowed = (await senderDecision(supabase, q.owner_id, fromEmail)) === "approved";
  if (!allowed) {
    await finish(logId, { ...base, status: "wrong_sender", reason: "from address is not this landlord" });
    return { status: "wrong_sender", reason: "from address is not this landlord" };
  }

  const text = extractReplyText({
    text: parsed.text, html: typeof parsed.html === "string" ? parsed.html : "",
    senderName: q.users?.name, senderCompany: q.users?.company_name, fromName: parsed.from?.value?.[0]?.name,
  }).trim();

  // Flyers and attachments go straight into the knowledge base.
  let docs = 0;
  for (const f of attachments) {
    try {
      const r = await ingestDocument({ listingId: q.listing_id, content: f.content, contentType: f.contentType, fileName: f.fileName, uploadedBy: q.owner_id, cause: "landlord_answer", landlordSet: true, actorId: q.owner_id, question: q.question });
      if (r.synthesis) docs++;
    } catch (err) {
      console.error("[proxy] email attachment ingest failed:", err?.message ?? err);
    }
  }

  if (!text && !docs) {
    await finish(logId, { ...base, status: "empty", reason: "no new text" });
    return { status: "empty", reason: "no new text" };
  }
  const kind = text ? (await classifyReply({ question: q.question, text, listingId: q.listing_id })).kind : "answer";
  const body = text || "Please see the details I've shared.";
  const result = await answerQuestion({ questionId: q.id, landlordUserId: q.owner_id, body, done: kind === "other" ? true : null, via: "email" });
  if (result.error) {
    await finish(logId, { ...base, status: "rejected", reason: String(result.error).slice(0, 200) });
    return { status: "rejected", reason: result.error };
  }
  await finish(logId, { ...base, status: "posted", reason: kind === "clarifier" ? "clarifier relayed" : "answer relayed", body_preview: text.slice(0, 2000) || null });
  return { status: "posted", reason: kind, relayedTo: result.relayedTo };
}
