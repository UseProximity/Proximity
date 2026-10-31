/*
 * Questions Proxy sends to landlords, and what comes back (PRD v3).
 *
 * askLandlord      one question row per listing per distinct question, routed
 *                  to the owner of the lease the student chose (contacts are
 *                  per lease), else the primary owner, else the placeholder
 *                  account behind the listing's contact email. A question
 *                  already open on the listing is reused: the new thread
 *                  joins it as a waiter, so the landlord is asked once and
 *                  every waiting student gets the answer. Exact matches are
 *                  found by normalising the text; near matches by asking
 *                  Haiku.
 * answerQuestion   the landlord's reply, in the app or by email. Contact
 *                  details are removed. A reply that is not final is a
 *                  clarifying question, relayed to the students; a final one
 *                  is synthesized into the listing's knowledge (every answer
 *                  is saved, Wyatt 2026-10-26) and relayed to every waiting
 *                  thread in Proxy's own words.
 * studentReplyToClarifier   the student's side of that exchange.
 * A student who follows up on a question their thread already asked reopens
 * that question (one card per question, Wyatt 2026-10-29): only the threads
 * still waiting (relayed_at null) hear what the landlord says next.
 *
 * Nothing here ever shows a landlord who asked. The context line is the
 * lease and whether the asker was signed in.
 */
import supabase from "@/lib/supabase";
import { z } from "zod";
import { parseStructured, HAIKU } from "./model";
import { postProxyMessage } from "./threads";
import { screenLandlordText, screenStudentText } from "./screen";
import { synthesizeKnowledge } from "./synthesize";
import { findOrCreateSource } from "./store";
import { notifyLandlordQuestion, notifyLandlordStudentReply, notifyStudentThread } from "./notify";
import { stampReplyToken } from "./questionTokens";
import { ingestLinks } from "./ingest";
import { heldThreadIds } from "./visitorEmail";

const fail = (where, error) => new Error(`${where}: ${error.message}`);

export function normalizeQuestion(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9\s$]/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
}

async function resolveOwner({ ctx, leaseId }) {
  const lease = leaseId ? ctx.leases.find((l) => l.id === leaseId) : null;
  if (lease?.ownerId) return lease.ownerId;
  if (ctx.ownerCount === 1) {
    const only = ctx.leases.find((l) => l.ownerId)?.ownerId;
    if (only) return only;
  }
  if (ctx.primaryOwner) return ctx.primaryOwner;
  if (ctx.contactEmail) {
    const { data } = await supabase.rpc("fn_chat_find_or_create_contact_user", { p_email: ctx.contactEmail, p_name: null });
    if (data) return data;
  }
  return null;
}

const SameQuestion = z.object({
  match: z.number().int().describe("The number of the open question that asks the same thing, or 0 if none does."),
});

async function findOpenMatch({ listingId, ownerId, leaseId, questionText, normalized }) {
  let q = supabase.from("listing_questions").select("id, question, normalized, lease_id, owner_id, asked_count")
    .eq("listing_id", listingId).eq("status", "open").order("created_at", { ascending: false }).limit(12);
  q = ownerId ? q.eq("owner_id", ownerId) : q.is("owner_id", null);
  const { data: open, error } = await q;
  if (error) throw fail("open questions", error);
  const candidates = (open ?? []).filter((o) => !o.lease_id || !leaseId || o.lease_id === leaseId);
  if (!candidates.length) return null;
  const exact = candidates.find((o) => o.normalized === normalized);
  if (exact) return exact;
  try {
    const { parsed } = await parseStructured({
      model: HAIKU, listingId, kind: "dedupe", tag: "question-dedupe", maxTokens: 100,
      system: "You compare questions students ask about a rental listing. Two questions are the same when one answer from the landlord would answer both. Different units, different owners or different topics are not the same.",
      messages: [{ role: "user", content: `New question: "${questionText}"\n\nOpen questions:\n${candidates.map((o, i) => `${i + 1}. ${o.question}`).join("\n")}` }],
      schema: SameQuestion,
    });
    const idx = Number(parsed?.match) || 0;
    return idx > 0 && idx <= candidates.length ? candidates[idx - 1] : null;
  } catch (err) {
    console.error("[proxy] dedupe failed:", err?.message ?? err);
    return null;
  }
}

const FollowUp = z.object({
  match: z.number().int().describe("The number of the earlier question the new one follows up on, or 0 when it is about something else."),
});

/* An earlier question from this same thread that the new one continues, if any. */
async function findFollowUp({ listingId, threadId, questionText }) {
  const { data: waits } = await supabase.from("listing_question_waiters").select("question_id").eq("thread_id", threadId).limit(30);
  const ids = (waits ?? []).map((w) => w.question_id);
  if (!ids.length) return null;
  const { data: mine } = await supabase.from("listing_questions").select("id, question, answer, status, owner_id, asked_count")
    .in("id", ids).eq("listing_id", listingId).in("status", ["open", "answered"]).order("last_activity_at", { ascending: false }).limit(8);
  if (!mine?.length) return null;
  try {
    const { parsed } = await parseStructured({
      model: HAIKU, listingId, kind: "followup", tag: "question-followup", maxTokens: 100,
      system: "A student is asking a rental listing's landlord a question through Proxy. Decide whether the new question follows up on one of the student's earlier questions: it continues the same topic, asking for more about the same thing (\"is there laundry?\" then \"what brand is the washer?\"), or pushes back on the answer. A question about a different topic is not a follow-up, even if it is about the same unit.",
      messages: [{ role: "user", content: `The student's earlier questions:\n${mine.map((q, i) => `${i + 1}. ${q.question}${q.answer ? ` (answered: ${q.answer.slice(0, 200)})` : ""}`).join("\n")}\n\nNew question: "${questionText}"` }],
      schema: FollowUp,
    });
    const idx = Number(parsed?.match) || 0;
    return idx > 0 && idx <= mine.length ? mine[idx - 1] : null;
  } catch (err) {
    console.error("[proxy] follow-up check failed:", err?.message ?? err);
    return null;
  }
}

/* The follow-up goes into the earlier question's card, which opens again for this thread. */
async function reopenWithFollowUp({ q, thread, text, userId }) {
  const now = new Date().toISOString();
  await supabase.from("listing_question_messages").insert({ question_id: q.id, sender: "student", kind: "followup", thread_id: thread.id, user_id: userId, body: text.slice(0, 2000) });
  await supabase.from("listing_questions").update({ status: "open", pending_clarifier: false, last_activity_at: now }).eq("id", q.id);
  await supabase.from("listing_question_waiters").update({ relayed_at: null }).eq("question_id", q.id).eq("thread_id", thread.id);
  if (q.owner_id) await notifyLandlordStudentReply({ questionId: q.id }).catch((err) => console.error("[proxy] follow-up alert failed:", err?.message ?? err));
}

export async function askLandlord({ ctx, thread, messageId, questionText, leaseId = null, askerUserId = null, visitorId = null }) {
  const listingId = ctx.listingId;
  // Contact details never reach the landlord (Wyatt, 2026-10-29); Proxy tells the student.
  const question = screenStudentText(String(questionText ?? "").trim()).text.slice(0, 1000);
  if (!question) return null;
  // Same thread, same topic: the earlier card again, always (Wyatt, 2026-10-29).
  const followed = thread?.id ? await findFollowUp({ listingId, threadId: thread.id, questionText: question }) : null;
  if (followed) {
    await reopenWithFollowUp({ q: followed, thread, text: question, userId: askerUserId });
    return followed;
  }
  const ownerId = await resolveOwner({ ctx, leaseId });
  const normalized = normalizeQuestion(question);
  const lease = leaseId ? ctx.leases.find((l) => l.id === leaseId) : null;
  const context = `${lease ? `About the ${lease.label}` : "About the property"}, from a ${askerUserId ? "signed-in" : "signed-out"} student`;

  const match = await findOpenMatch({ listingId, ownerId, leaseId, questionText: question, normalized });
  let row = match;
  if (match) {
    await supabase.from("listing_questions").update({ asked_count: (match.asked_count ?? 1) + 1, last_activity_at: new Date().toISOString() }).eq("id", match.id);
  } else {
    const { data, error } = await supabase.from("listing_questions").insert({
      listing_id: listingId, lease_id: leaseId, owner_id: ownerId, status: ownerId ? "open" : "unroutable",
      question, normalized, context, first_thread_id: thread.id,
    }).select("*").single();
    if (error) throw fail("question create", error);
    row = data;
    if (ownerId) await stampReplyToken({ questionId: row.id, ownerId }).catch((err) => console.error("[proxy] reply token:", err?.message ?? err));
  }
  await supabase.from("listing_question_waiters").upsert(
    { question_id: row.id, thread_id: thread.id, message_id: messageId, user_id: askerUserId, visitor_id: askerUserId ? null : visitorId },
    { onConflict: "question_id,thread_id", ignoreDuplicates: true }
  );
  if (!match && ownerId) {
    // Sent inside the request: on Vercel a background send dies when the response goes out.
    await notifyLandlordQuestion({ questionId: row.id }).catch((err) => console.error("[proxy] landlord alert failed:", err?.message ?? err));
  }
  return row;
}

/*
 * The clarifying question waiting on this thread's student, if any: an open
 * question this thread still waits on, where the landlord wrote after this
 * student last did. Worked out per thread, so when several students were
 * asked, each one's reply counts, not only the first (2026-10-29).
 */
export async function pendingClarifierFor(threadId) {
  const { data: waits } = await supabase.from("listing_question_waiters").select("question_id").eq("thread_id", threadId).is("relayed_at", null).limit(20);
  const ids = (waits ?? []).map((w) => w.question_id);
  if (!ids.length) return null;
  const { data: qs } = await supabase.from("listing_questions").select("*").in("id", ids).eq("status", "open").order("last_activity_at", { ascending: false }).limit(5);
  if (!qs?.length) return null;
  const { data: msgs } = await supabase.from("listing_question_messages").select("question_id, sender, thread_id, body, created_at")
    .in("question_id", qs.map((q) => q.id)).order("created_at", { ascending: true });
  for (const q of qs) {
    const ms = (msgs ?? []).filter((m) => m.question_id === q.id);
    const asked = ms.filter((m) => m.sender === "landlord").pop();
    const mine = ms.filter((m) => m.sender === "student" && m.thread_id === threadId).pop();
    if (asked && (!mine || mine.created_at < asked.created_at)) return { ...q, clarifier: asked.body };
  }
  return null;
}

export async function studentReplyToClarifier({ question, thread, body, userId = null }) {
  const screened = screenStudentText(body);
  await supabase.from("listing_question_messages").insert({ question_id: question.id, sender: "student", kind: "reply", thread_id: thread.id, user_id: userId, body: (screened.text || "(The student sent only contact details, which Proxy does not pass on.)").slice(0, 2000), raw_body: screened.removed ? screened.original : null, screened: screened.removed > 0 });
  await supabase.from("listing_questions").update({ pending_clarifier: false, last_activity_at: new Date().toISOString() }).eq("id", question.id);
  await notifyLandlordStudentReply({ questionId: question.id }).catch((err) => console.error("[proxy] reply alert failed:", err?.message ?? err));
}

/*
 * The whole back-and-forth on a question, for the knowledge base: a final
 * "that will work" only means something next to the landlord's earlier
 * question and the student's reply (Wyatt, 2026-10-27).
 */
async function exchangeText(q, latest) {
  const { data } = await supabase.from("listing_question_messages").select("sender, body").eq("question_id", q.id).order("created_at", { ascending: true });
  const lines = (data ?? []).map((m) => `${m.sender === "landlord" ? "Landlord" : m.sender === "student" ? "Student" : "Proxy"}: ${m.body}`);
  if (lines.length <= 1) return latest;
  return `Conversation about this question, oldest first. Save what the landlord's answers establish, reading the final reply in light of the earlier messages.\n${lines.join("\n")}`;
}

async function waitersOf(questionId) {
  const { data } = await supabase.from("listing_question_waiters").select("id, thread_id, user_id, visitor_id, relayed_at").eq("question_id", questionId);
  return data ?? [];
}

const ReplyKind = z.object({
  kind: z.enum(["answer", "clarifier", "both", "other"]).describe("answer: it answers the question. clarifier: it only asks the student something before answering. both: it gives an answer AND asks the student a follow-up question. other: unrelated, empty, or an out-of-office style message."),
  answer_part: z.string().describe("For both: the answering part of the reply, in the landlord's words. Otherwise empty."),
  question_part: z.string().describe("For both: the question the landlord asks the student, in the landlord's words. Otherwise empty."),
});

/*
 * What a landlord's reply is: an answer, or a question back to the student.
 * The landlord writes one thing in one box (Wyatt, 2026-10-27) and Proxy
 * tells the two apart, in the app and by email alike.
 */
export async function classifyReply({ question, text, listingId }) {
  try {
    const { parsed } = await parseStructured({
      model: HAIKU, listingId, kind: "classify_reply", tag: "reply-kind", maxTokens: 400,
      system: "A landlord replied to a question a student asked through Proxy, a rental listing's assistant. Decide what the reply is. A reply that only asks the student for a detail before answering (which unit, when, how many) is a clarifier. A reply that answers and also asks the student something is both: split it into the answer part and the question part.",
      messages: [{ role: "user", content: `Question: "${question}"\n\nReply:\n\"\"\"\n${text.slice(0, 3000)}\n\"\"\"` }],
      schema: ReplyKind,
    });
    return { kind: parsed?.kind ?? "answer", answerPart: parsed?.answer_part?.trim() ?? "", questionPart: parsed?.question_part?.trim() ?? "" };
  } catch {
    return { kind: "answer", answerPart: "", questionPart: "" };
  }
}

const RelayWording = z.object({
  message: z.string().describe("Proxy's message to the student: one or two plain sentences in Proxy's own voice, first person, passing on what the landlord said (for example 'I've gotten confirmation from the landlord that ...' or 'The landlord got back to me: ...'). If there is a follow-up question from the landlord, ask it naturally in the same message and say to reply here. No label like 'From the landlord:', no quotation marks around the landlord's words, no contact details, no em dash."),
});

/*
 * What Proxy tells the student when the landlord has answered, optionally
 * with a follow-up question. One or two grey sentences in Proxy's words
 * (Wyatt, 2026-10-27: everything is filtered through Proxy).
 */
export async function proxyRelays({ question, answer, followUp = "", listingId }) {
  const fallback = followUp
    ? `The landlord got back to me: ${answer} They also want to know: ${followUp} Reply here and I'll pass it on.`
    : `The landlord got back to me: ${answer}`;
  try {
    const { parsed } = await parseStructured({
      model: HAIKU, listingId, kind: "relay_wording", tag: "relay-wording", maxTokens: 260,
      system: "You are Proxy, the friendly assistant on a rental listing. A student asked a question through you and the landlord has now replied to you. Write what you tell the student. Keep every fact the landlord gave and add nothing: no caveats, no guesses, nothing about what the landlord did not mention.",
      messages: [{ role: "user", content: `The student asked: "${question}"\n\nThe landlord's reply: "${answer}"${followUp ? `\n\nThe landlord also asks the student: "${followUp}"` : ""}` }],
      schema: RelayWording,
    });
    const text = parsed?.message?.trim();
    return text && text.length > 10 ? text : fallback;
  } catch {
    return fallback;
  }
}

const ClarifierWording = z.object({
  message: z.string().describe("Proxy's message to the student: one or two plain sentences in Proxy's own voice saying the landlord needs one detail before they can answer, asking that question naturally (reworded, not quoted), and saying to reply here. No greeting, no label, no contact details, no em dash."),
});

/*
 * A landlord's question back, asked by Proxy in its own words (Wyatt,
 * 2026-10-27). Falls back to a plain relay if the model is unavailable.
 */
export async function proxyAsksClarifier({ question, clarifier, listingId }) {
  const fallback = `The landlord needs one thing before they can answer: ${clarifier} Reply here and I'll pass it on.`;
  try {
    const { parsed } = await parseStructured({
      model: HAIKU, listingId, kind: "clarifier_wording", tag: "clarifier-wording", maxTokens: 220,
      system: "You are Proxy, the friendly assistant on a rental listing. A student asked a question through you; the landlord replied with a question of their own before answering. Write what you say to the student. Make it clear the question comes from the landlord.",
      messages: [{ role: "user", content: `The student asked: "${question}"\n\nThe landlord replied with this question: "${clarifier}"` }],
      schema: ClarifierWording,
    });
    const text = parsed?.message?.trim();
    return text && text.length > 20 ? text : fallback;
  } catch {
    return fallback;
  }
}

/*
 * The landlord answers. `done` false = a clarifying question for the
 * student; null = let classifyReply decide from the text.
 * Returns { question, kind, relayedTo, synthesis, screened }.
 */
export async function answerQuestion({ questionId, landlordUserId, body, done = null, via = "app" }) {
  const { data: q, error } = await supabase.from("listing_questions").select("*").eq("id", questionId).maybeSingle();
  if (error) throw fail("question", error);
  if (!q) return { error: "Question not found", status: 404 };
  if (q.owner_id && q.owner_id !== landlordUserId) return { error: "This question was sent to another landlord", status: 403 };
  if (!["open", "answered"].includes(q.status)) return { error: "This question is already closed", status: 409 };
  // Writing on an answered card (a correction, an extra detail) reaches
  // everyone who asked it, so they all wait for this reply again.
  if (q.status === "answered") await supabase.from("listing_question_waiters").update({ relayed_at: null }).eq("question_id", q.id);

  const screened = screenLandlordText(body);
  if (!screened.text) return { error: "Write an answer first.", status: 400 };
  if (screened.onlyContact) {
    return { error: "Contact details are shared with a student only when they book a tour. Please answer the question itself.", status: 422, screened: true };
  }
  let both = null;
  if (done == null) {
    const c = await classifyReply({ question: q.question, text: screened.text, listingId: q.listing_id });
    done = c.kind !== "clarifier";
    if (c.kind === "both" && c.answerPart && c.questionPart) both = c;
  }
  await supabase.from("listing_question_messages").insert({
    question_id: q.id, sender: "landlord", user_id: landlordUserId, body: screened.text, raw_body: screened.removed ? screened.original : null,
    screened: screened.removed > 0, via,
  });
  // Only the students still waiting: one who followed up hears the reply, the others already have their answer.
  const waiters = (await waitersOf(q.id)).filter((w) => !w.relayed_at);
  const now = new Date().toISOString();

  // An answer with a follow-up question (Wyatt, 2026-10-27): the student gets
  // the answer now, Proxy asks the follow-up in turn, and the question stays
  // open for the student's reply and the landlord's final word.
  if (both) {
    const answerText = screenLandlordText(both.answerPart).text || screened.text;
    const followUp = screenLandlordText(both.questionPart).text;
    try {
      const source = await findOrCreateSource({ listingId: q.listing_id, kind: "landlord_answer", questionId: q.id, userId: landlordUserId, label: `Answer to: ${q.question.slice(0, 120)}` });
      const { data: primary } = await supabase.from("listing_landlords").select("user_id").eq("listing_id", q.listing_id).eq("is_primary", true).maybeSingle();
      await synthesizeKnowledge({
        listingId: q.listing_id, text: await exchangeText(q, answerText), sourceKind: "landlord_answer", sourceId: source.id, sourceRef: `question:${q.id}`,
        cause: "landlord_answer", landlordSet: true, setBy: landlordUserId, actorId: landlordUserId, question: q.question,
        ownerDefault: primary?.user_id && primary.user_id !== landlordUserId ? landlordUserId : null,
      });
    } catch (err) {
      console.error("[proxy] synthesis failed:", err?.message ?? err);
    }
    await supabase.from("listing_questions").update({ status: "open", pending_clarifier: true, answer: answerText, last_activity_at: now }).eq("id", q.id);
    const combined = await proxyRelays({ question: q.question, answer: answerText, followUp, listingId: q.listing_id });
    const heldB = await heldThreadIds(waiters.map((w) => w.thread_id));
    for (const w of waiters) {
      if (heldB.has(w.thread_id)) continue;
      await postProxyMessage({ threadId: w.thread_id, listingId: q.listing_id, type: "proxy_relay", body: combined, metadata: { questionId: q.id, clarifier: true, landlordAsked: followUp } });
      await notifyStudentThread({ threadId: w.thread_id, kind: "proxy_relay", quietMs: 0 }).catch(() => {});
    }
    return { question: { ...q, pending_clarifier: true }, kind: "both", relayedTo: waiters.length, synthesis: null, screened: screened.removed > 0 };
  }

  if (!done) {
    await supabase.from("listing_questions").update({ status: "open", pending_clarifier: true, last_activity_at: now }).eq("id", q.id);
    // Proxy asks the landlord's question in turn, in its own words, and says whose it is.
    const asked = await proxyAsksClarifier({ question: q.question, clarifier: screened.text, listingId: q.listing_id });
    const heldC = await heldThreadIds(waiters.map((w) => w.thread_id));
    for (const w of waiters) {
      if (heldC.has(w.thread_id)) continue; // waits for the login, released by the claim
      await postProxyMessage({ threadId: w.thread_id, listingId: q.listing_id, type: "proxy_relay", body: asked, metadata: { questionId: q.id, clarifier: true, landlordAsked: screened.text } });
      await notifyStudentThread({ threadId: w.thread_id, kind: "proxy_relay", quietMs: 0 }).catch(() => {});
    }
    return { question: { ...q, pending_clarifier: true }, kind: "clarifier", relayedTo: waiters.length, synthesis: null, screened: screened.removed > 0 };
  }

  // Final answer: into the knowledge base, then to every waiting student.
  let synthesis = null;
  let links = [];
  const { data: primary } = await supabase.from("listing_landlords").select("user_id").eq("listing_id", q.listing_id).eq("is_primary", true).maybeSingle();
  const nonPrimary = primary?.user_id && primary.user_id !== landlordUserId;
  const ownerDefault = nonPrimary ? landlordUserId : null;
  try {
    const source = await findOrCreateSource({ listingId: q.listing_id, kind: "landlord_answer", questionId: q.id, userId: landlordUserId, label: `Answer to: ${q.question.slice(0, 120)}` });
    synthesis = await synthesizeKnowledge({
      listingId: q.listing_id, text: await exchangeText(q, screened.text), sourceKind: "landlord_answer", sourceId: source.id, sourceRef: `question:${q.id}`,
      cause: "landlord_answer", landlordSet: true, setBy: landlordUserId, actorId: landlordUserId, question: q.question, ownerDefault,
    });
  } catch (err) {
    console.error("[proxy] synthesis failed:", err?.message ?? err);
  }
  // Every answered question leaves something the landlord can see (Wyatt,
  // 2026-10-27): when the answer set no general fact, it is kept as a
  // question-and-answer pair, which Proxy also answers from.
  if (!synthesis || (synthesis.written ?? 0) + (synthesis.unchanged ?? 0) + (synthesis.held ?? 0) === 0) {
    try {
      const { setFact } = await import("./store");
      const source = await findOrCreateSource({ listingId: q.listing_id, kind: "landlord_answer", questionId: q.id, userId: landlordUserId, label: `Answer to: ${q.question.slice(0, 120)}` });
      const thread = (await exchangeText(q, screened.text)).split("\n").slice(1).join(" / ");
      await setFact({
        listingId: q.listing_id, section: "misc", fieldKey: `qa.${q.id.slice(0, 8)}`,
        value: { question: q.question, answer: screened.text, exchange: thread || null },
        summary: `Asked: ${q.question} Answer: ${screened.text}${thread && thread.includes("Student:") ? ` (in reply to: ${thread.slice(0, 300)})` : ""}`.slice(0, 600),
        scopeLevel: ownerDefault ? "owner" : "property", scopeId: ownerDefault,
        sourceId: source.id, sourceRef: `question:${q.id}`, landlordSet: true, setBy: landlordUserId, actorId: landlordUserId, cause: "landlord_answer",
      });
      synthesis = { ...(synthesis ?? {}), written: 1, notes: "saved as a question-and-answer pair" };
    } catch (err) {
      console.error("[proxy] q&a save failed:", err?.message ?? err);
    }
  }
  // A link in the answer (a flyer, a fee page) is read into the knowledge
  // base too, from the text as written, since screening removes links.
  try {
    links = await ingestLinks({ listingId: q.listing_id, text: screened.original, cause: "landlord_answer", landlordSet: true, actorId: landlordUserId, ownerDefault, question: q.question });
  } catch (err) {
    console.error("[proxy] link ingest failed:", err?.message ?? err);
  }
  // Proxy rewords the landlord's own words, not the knowledge-base version,
  // so nothing the landlord did not say creeps into the relay.
  const { data: prior } = await supabase.from("listing_question_messages").select("sender, body").eq("question_id", q.id).order("created_at", { ascending: true });
  const earlier = (prior ?? []).slice(0, -1).map((m) => `${m.sender === "landlord" ? "Landlord" : "Student"}: ${m.body}`).join(" / ");
  const relayText = await proxyRelays({ question: earlier ? `${q.question} (earlier: ${earlier})` : q.question, answer: screened.text, listingId: q.listing_id });
  await supabase.from("listing_questions").update({
    status: "answered", answer: screened.text, answered_by: landlordUserId, answered_at: now, pending_clarifier: false, last_activity_at: now,
  }).eq("id", q.id);
  let relayedTo = 0;
  const held = await heldThreadIds(waiters.map((w) => w.thread_id));
  for (const w of waiters) {
    if (held.has(w.thread_id)) continue; // waits for the login, released by the claim
    await postProxyMessage({ threadId: w.thread_id, listingId: q.listing_id, type: "proxy_relay", body: relayText, metadata: { questionId: q.id } });
    await supabase.from("listing_question_waiters").update({ relayed_at: now }).eq("id", w.id);
    await notifyStudentThread({ threadId: w.thread_id, kind: "proxy_relay", quietMs: 0 }).catch(() => {});
    relayedTo++;
  }
  return { question: { ...q, status: "answered", answer: screened.text }, kind: "answer", relayedTo, synthesis, links, screened: screened.removed > 0 };
}

/* The landlord's queue: open questions first, then recent answered ones. */
export async function listLandlordQuestions(userId, { limit = 100 } = {}) {
  const { data, error } = await supabase.from("listing_questions")
    .select("id, listing_id, lease_id, status, question, context, asked_count, answer, answered_at, pending_clarifier, created_at, last_activity_at, listings!listing_id(title, address), unit_leases!lease_id(rent, listing_units!unit_id(name, bedrooms, bathrooms))")
    .eq("owner_id", userId).in("status", ["open", "answered"]).order("status", { ascending: false }).order("last_activity_at", { ascending: false }).limit(limit);
  if (error) throw fail("questions", error);
  const ids = (data ?? []).map((q) => q.id);
  const { data: msgs } = ids.length
    ? await supabase.from("listing_question_messages").select("question_id, sender, body, created_at").in("question_id", ids).order("created_at", { ascending: true })
    : { data: [] };
  const byQ = new Map();
  for (const m of msgs ?? []) { if (!byQ.has(m.question_id)) byQ.set(m.question_id, []); byQ.get(m.question_id).push(m); }
  return (data ?? []).map((q) => ({
    id: q.id, listingId: q.listing_id, listingTitle: q.listings?.title || q.listings?.address || "Listing", listingAddress: q.listings?.address ?? null,
    lease: q.unit_leases ? { rent: q.unit_leases.rent, unit: q.unit_leases.listing_units?.name || `${q.unit_leases.listing_units?.bedrooms ?? "?"} bed, ${q.unit_leases.listing_units?.bathrooms ?? "?"} bath` } : null,
    status: q.status, question: q.question, context: q.context, askedCount: q.asked_count, answer: q.answer, answeredAt: q.answered_at,
    pendingClarifier: q.pending_clarifier, createdAt: q.created_at, lastActivityAt: q.last_activity_at,
    exchange: byQ.get(q.id) ?? [],
  }));
}
