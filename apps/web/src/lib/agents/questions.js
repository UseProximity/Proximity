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
 *                  thread as "From the landlord".
 * studentReplyToClarifier   the student's side of that exchange.
 *
 * Nothing here ever shows a landlord who asked. The context line is the
 * lease and whether the asker was signed in.
 */
import supabase from "@/lib/supabase";
import { z } from "zod";
import { parseStructured, HAIKU } from "./model";
import { postProxyMessage } from "./threads";
import { screenLandlordText } from "./screen";
import { synthesizeKnowledge } from "./synthesize";
import { findOrCreateSource } from "./store";
import { notifyLandlordQuestion, notifyLandlordStudentReply, notifyStudentThread } from "./notify";
import { stampReplyToken } from "./questionTokens";
import { ingestLinks } from "./ingest";

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

export async function askLandlord({ ctx, thread, messageId, questionText, leaseId = null, askerUserId = null, visitorId = null }) {
  const listingId = ctx.listingId;
  const question = String(questionText ?? "").trim().slice(0, 1000);
  if (!question) return null;
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
    notifyLandlordQuestion({ questionId: row.id }).catch((err) => console.error("[proxy] landlord alert failed:", err?.message ?? err));
  }
  return row;
}

/* The clarifying question waiting on this thread's student, if any. */
export async function pendingClarifierFor(threadId) {
  const { data: waits } = await supabase.from("listing_question_waiters").select("question_id").eq("thread_id", threadId).limit(20);
  const ids = (waits ?? []).map((w) => w.question_id);
  if (!ids.length) return null;
  const { data: qs } = await supabase.from("listing_questions").select("*").in("id", ids).eq("status", "open").eq("pending_clarifier", true)
    .order("last_activity_at", { ascending: false }).limit(1);
  const q = qs?.[0];
  if (!q) return null;
  const { data: msgs } = await supabase.from("listing_question_messages").select("body").eq("question_id", q.id).eq("sender", "landlord")
    .order("created_at", { ascending: false }).limit(1);
  return { ...q, clarifier: msgs?.[0]?.body ?? "" };
}

export async function studentReplyToClarifier({ question, thread, body, userId = null }) {
  await supabase.from("listing_question_messages").insert({ question_id: question.id, sender: "student", thread_id: thread.id, user_id: userId, body: String(body).slice(0, 2000) });
  await supabase.from("listing_questions").update({ pending_clarifier: false, last_activity_at: new Date().toISOString() }).eq("id", question.id);
  notifyLandlordStudentReply({ questionId: question.id }).catch((err) => console.error("[proxy] reply alert failed:", err?.message ?? err));
}

async function waitersOf(questionId) {
  const { data } = await supabase.from("listing_question_waiters").select("id, thread_id, user_id, visitor_id, relayed_at").eq("question_id", questionId);
  return data ?? [];
}

/*
 * The landlord answers. `done` false = a clarifying question for the student.
 * Returns { question, relayedTo, synthesis, screened }.
 */
export async function answerQuestion({ questionId, landlordUserId, body, done = true, via = "app" }) {
  const { data: q, error } = await supabase.from("listing_questions").select("*").eq("id", questionId).maybeSingle();
  if (error) throw fail("question", error);
  if (!q) return { error: "Question not found", status: 404 };
  if (q.owner_id && q.owner_id !== landlordUserId) return { error: "This question was sent to another landlord", status: 403 };
  if (q.status !== "open") return { error: "This question is already closed", status: 409 };

  const screened = screenLandlordText(body);
  if (!screened.text) return { error: "Write an answer first.", status: 400 };
  if (screened.onlyContact) {
    return { error: "Contact details are shared with a student only when they book a tour. Please answer the question itself.", status: 422, screened: true };
  }
  await supabase.from("listing_question_messages").insert({
    question_id: q.id, sender: "landlord", user_id: landlordUserId, body: screened.text, raw_body: screened.removed ? screened.original : null,
    screened: screened.removed > 0, via,
  });
  const waiters = await waitersOf(q.id);
  const now = new Date().toISOString();

  if (!done) {
    await supabase.from("listing_questions").update({ pending_clarifier: true, last_activity_at: now }).eq("id", q.id);
    for (const w of waiters) {
      await postProxyMessage({ threadId: w.thread_id, listingId: q.listing_id, type: "proxy_relay", body: `The landlord asks: ${screened.text}`, metadata: { questionId: q.id, clarifier: true } });
      notifyStudentThread({ threadId: w.thread_id, kind: "proxy_relay" }).catch(() => {});
    }
    return { question: { ...q, pending_clarifier: true }, relayedTo: waiters.length, synthesis: null, screened: screened.removed > 0 };
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
      listingId: q.listing_id, text: screened.text, sourceKind: "landlord_answer", sourceId: source.id, sourceRef: `question:${q.id}`,
      cause: "landlord_answer", landlordSet: true, setBy: landlordUserId, actorId: landlordUserId, question: q.question, ownerDefault,
    });
  } catch (err) {
    console.error("[proxy] synthesis failed:", err?.message ?? err);
  }
  // A link in the answer (a flyer, a fee page) is read into the knowledge
  // base too, from the text as written, since screening removes links.
  try {
    links = await ingestLinks({ listingId: q.listing_id, text: screened.original, cause: "landlord_answer", landlordSet: true, actorId: landlordUserId, ownerDefault, question: q.question });
  } catch (err) {
    console.error("[proxy] link ingest failed:", err?.message ?? err);
  }
  const relayText = synthesis?.answer ? screenLandlordText(synthesis.answer).text : screened.text;
  await supabase.from("listing_questions").update({
    status: "answered", answer: screened.text, answered_by: landlordUserId, answered_at: now, pending_clarifier: false, last_activity_at: now,
  }).eq("id", q.id);
  let relayedTo = 0;
  for (const w of waiters) {
    await postProxyMessage({ threadId: w.thread_id, listingId: q.listing_id, type: "proxy_relay", body: `From the landlord: ${relayText}`, metadata: { questionId: q.id } });
    await supabase.from("listing_question_waiters").update({ relayed_at: now }).eq("id", w.id);
    notifyStudentThread({ threadId: w.thread_id, kind: "proxy_relay" }).catch(() => {});
    relayedTo++;
  }
  return { question: { ...q, status: "answered", answer: screened.text }, relayedTo, synthesis, links, screened: screened.removed > 0 };
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
