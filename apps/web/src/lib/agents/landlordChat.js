/*
 * The landlord's Proxy chat, one per listing (Wyatt, 2026-10-27, round 6;
 * one all-purpose thread since round 7, 2026-10-28).
 *
 * Cards since 2026-10-29 (Wyatt): each question is one card holding its
 * whole back-and-forth, each tour request another, and the landlord's own
 * conversation with the listing's agent (landlord_agent_messages) runs
 * between them. A card sits at its latest activity, so whatever just
 * happened is at the bottom. The landlord writes in one box, aimed at a card
 * with its Reply button; otherwise Proxy guesses the card
 * (routeLandlordMessage) and the landlord confirms it with a click. Then it
 * goes to the question (answerQuestion: an answer, a question back, or
 * both), the tour (a message in the direct chat), or the agent (agentChat: a
 * reply, maybe with changes to confirm). Shown in the Agent tab, the
 * Questions tab and the landlord's Messages (Proxy tab).
 *
 * Never the student's name on questions, even when several students asked
 * (they read "One student" and "Another student"); tours carry the name.
 */
import supabase from "@/lib/supabase";
import { z } from "zod";
import { listLandlordTours, landlordAct } from "./tours";
import { parseStructured, HAIKU } from "./model";
import { answerQuestion } from "./questions";
import { agentChat, confirmProposal } from "./landlordAgent";
import { screenLandlordText, CONTACT_NOTE } from "./screen";

const fail = (where, error) => new Error(`${where}: ${error.message}`);
const OPEN_TOURS = ["requested", "proposed", "messaging"];

/*
 * What Proxy says after a landlord's reply to a question (Wyatt, 2026-10-29):
 * the landlord sees their message, then Proxy saying what it did with it.
 * Worked out from the exchange, so emailed replies read the same.
 */
const ACK = {
  answered: "Passed along and saved, so I can answer this myself next time.",
  asked: "I asked the student. Their reply will show up here.",
  askedSeveral: "I asked the students. Their replies will show up here.",
  passed: "Passed along.",
};

/* Listings this landlord has Proxy activity on, with what is waiting. */
export async function landlordProxyOverview(userId, { studentsOnly = false } = {}) {
  const [{ data: qs, error }, tours, { data: notes }] = await Promise.all([
    supabase.from("listing_questions").select("listing_id, status, pending_clarifier, question, created_at, last_activity_at, listings!listing_id(title, address, listing_images(url, sort_order))")
      .eq("owner_id", userId).in("status", ["open", "answered"]).order("last_activity_at", { ascending: false }).limit(500),
    listLandlordTours(userId),
    supabase.from("landlord_agent_messages").select("listing_id, sender, body, created_at, listings!listing_id(title, address, listing_images(url, sort_order))")
      .eq("landlord_id", userId).order("created_at", { ascending: false }).limit(300),
  ]);
  if (error) throw fail("landlord overview", error);
  const rows = new Map();
  const touch = (listingId, title, address, images, at, text) => {
    if (!rows.has(listingId)) {
      const img = (images ?? []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.url ?? null;
      rows.set(listingId, { listingId, title: title || address || "Listing", address: address ?? null, image: img, openQuestions: 0, openTours: 0, fromStudents: false, lastAt: at, lastText: text });
    }
    const r = rows.get(listingId);
    if (at > r.lastAt) { r.lastAt = at; r.lastText = text; }
    return r;
  };
  for (const q of qs ?? []) {
    const r = touch(q.listing_id, q.listings?.title, q.listings?.address, q.listings?.listing_images, q.last_activity_at ?? q.created_at, `A student asked: ${q.question}`);
    r.fromStudents = true;
    if (q.status === "open" && !q.pending_clarifier) r.openQuestions++;
  }
  for (const t of tours) {
    const r = touch(t.listingId, t.listingTitle, t.listingAddress, null, t.lastActivityAt ?? t.createdAt, `${t.studentName} wants to tour`);
    r.fromStudents = true;
    if (t.status === "requested") r.openTours++;
  }
  for (const m of notes ?? []) {
    touch(m.listing_id, m.listings?.title, m.listings?.address, m.listings?.listing_images, m.created_at, m.sender === "landlord" ? `You: ${m.body}` : m.body);
  }
  // The Questions tab shows only listings students have asked about or
  // asked to tour (Wyatt, 2026-10-28). A listing's other talk with its agent
  // stays in its Agent tab and in Messages.
  return [...rows.values()].filter((r) => !studentsOnly || r.fromStudents).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

/* What needs the landlord: open questions not waiting on a student, plus tour requests. */
export async function landlordWaitingCount(userId) {
  const [{ count: q }, { count: t }] = await Promise.all([
    supabase.from("listing_questions").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("status", "open").eq("pending_clarifier", false),
    supabase.from("tour_requests").select("id", { count: "exact", head: true }).eq("landlord_id", userId).eq("status", "requested"),
  ]);
  return { questions: q ?? 0, tours: t ?? 0, total: (q ?? 0) + (t ?? 0) };
}

/*
 * One listing's chat, oldest first: question cards with their exchange, tour
 * cards, and the agent talk. A card's place is its latest activity.
 */
export async function landlordProxyTimeline(userId, listingId) {
  const [{ data: listing }, { data: qs, error }, tours, { data: notes }] = await Promise.all([
    supabase.from("listings").select("id, title, address").eq("id", listingId).maybeSingle(),
    supabase.from("listing_questions").select("id, status, question, asked_count, answer, answered_at, pending_clarifier, created_at, last_activity_at")
      .eq("owner_id", userId).eq("listing_id", listingId).in("status", ["open", "answered"]).order("created_at", { ascending: true }).limit(200),
    listLandlordTours(userId),
    supabase.from("landlord_agent_messages").select("id, sender, body, question_id, tour_id, proposal, proposal_status, created_at")
      .eq("landlord_id", userId).eq("listing_id", listingId).order("created_at", { ascending: true }).limit(300),
  ]);
  if (error) throw fail("landlord timeline", error);
  const ids = (qs ?? []).map((q) => q.id);
  const { data: msgs } = ids.length
    ? await supabase.from("listing_question_messages").select("question_id, sender, kind, thread_id, body, raw_body, screened, via, created_at").in("question_id", ids).order("created_at", { ascending: true })
    : { data: [] };
  const byQ = new Map();
  for (const m of msgs ?? []) { if (!byQ.has(m.question_id)) byQ.set(m.question_id, []); byQ.get(m.question_id).push(m); }
  const latest = (...ats) => ats.filter(Boolean).sort().pop();

  const questionCard = (q) => {
    const ms = byQ.get(q.id) ?? [];
    // Students stay anonymous; with more than one in the card they read
    // "One student" and "Another student" (Wyatt, 2026-10-29).
    const threads = [...new Set(ms.filter((m) => m.sender === "student" && m.thread_id).map((m) => m.thread_id))];
    const several = (q.asked_count ?? 1) > 1 || threads.length > 1;
    const who = (m) => (!several ? "The student" : threads.indexOf(m.thread_id) <= 0 ? "One student" : "Another student");
    const lastMine = ms.map((m) => m.sender).lastIndexOf("landlord");
    const exchange = ms.map((m, i) => {
      if (m.sender !== "landlord") {
        return { id: `${q.id}:${i}`, from: "student", label: who(m), followup: m.kind === "followup", body: m.body, at: m.created_at };
      }
      // Under the landlord's own words, a line on what Proxy did with them.
      const studentNext = ms.slice(i + 1).some((x) => x.sender === "student" && x.kind !== "followup");
      const asked = several ? ACK.askedSeveral : ACK.asked;
      const ack = studentNext ? asked
        : i === lastMine && q.status === "answered" ? ACK.answered
        : i === lastMine && q.pending_clarifier ? asked
        : ACK.passed;
      return { id: `${q.id}:${i}`, from: "you", body: m.raw_body || m.body, via: m.via, note: m.screened ? `${ack} ${CONTACT_NOTE.landlord}` : ack, at: m.created_at };
    });
    const state = q.status === "answered" ? "answered" : q.pending_clarifier ? "waiting" : "needs_you";
    return {
      kind: "question", id: q.id, at: latest(q.created_at, q.last_activity_at, ms[ms.length - 1]?.created_at), askedAt: q.created_at,
      status: q.status, state, question: q.question, askedCount: q.asked_count, answer: q.answer, exchange,
    };
  };

  const tourNotes = new Map();
  for (const m of notes ?? []) if (m.tour_id) { if (!tourNotes.has(m.tour_id)) tourNotes.set(m.tour_id, []); tourNotes.get(m.tour_id).push(m); }
  const tourCard = (t) => {
    const mine = (tourNotes.get(t.id) ?? []).filter((m) => m.sender === "landlord").map((m) => ({ id: m.id, from: "you", body: m.body, note: "Sent to them in your direct chat.", at: m.created_at }));
    const state = t.status === "requested" || t.status === "proposed" ? "needs_you" : t.status === "messaging" ? "waiting" : t.status === "confirmed" ? "confirmed" : "closed";
    return { kind: "tour", id: t.id, at: latest(t.createdAt, t.lastActivityAt, mine[mine.length - 1]?.at), state, tour: t, exchange: mine };
  };

  const items = [
    ...(qs ?? []).map(questionCard),
    ...tours.filter((t) => t.listingId === listingId).map(tourCard),
    // What the landlord wrote on a card shows inside that card.
    ...(notes ?? []).filter((m) => !(m.sender === "landlord" && (m.question_id || m.tour_id))).map((m) => ({
      kind: "agent", id: m.id, at: m.created_at, sender: m.sender, body: m.body,
      proposal: m.proposal_status === "open" ? m.proposal : null, proposalStatus: m.proposal_status,
    })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));
  return {
    listing: listing ? { id: listing.id, title: listing.title || listing.address || "Listing", address: listing.address } : null,
    items,
    needsYou: items.filter((i) => i.state === "needs_you").length,
    openQuestions: items.filter((i) => i.kind === "question" && i.status === "open").length,
    openTours: items.filter((i) => i.kind === "tour" && OPEN_TOURS.includes(i.tour.status)).length,
  };
}

/* ---- one box for everything (round 7) ----------------------------------- */

const Route = z.object({
  question_number: z.number().int().describe("The number of the open question this message answers or replies to, or 0 when it answers none of them (a general update, an instruction, or a question for the agent)."),
  sure: z.boolean().describe("True only when the message plainly fits that choice and no other open question. False when it could fit more than one, or it is unclear whether it is meant for a student or for Proxy."),
});

/*
 * Which open question, if any, a landlord's message is aimed at, and whether
 * Proxy is sure. Fast (Haiku): the client asks the landlord to confirm the
 * guess with a click, or to pick the question when Proxy is unsure (Wyatt,
 * 2026-10-29). Only a sure "not for a student" goes straight to the agent.
 */
export async function routeLandlordMessage({ userId, listingId, text }) {
  const body = String(text ?? "").trim();
  if (!body) return { questionId: null, sure: true };
  const { data: open } = await supabase.from("listing_questions").select("id, question, created_at")
    .eq("owner_id", userId).eq("listing_id", listingId).eq("status", "open").order("created_at", { ascending: true }).limit(20);
  if (!open?.length) return { questionId: null, sure: true };
  // Recent agent talk, so "yes" after the agent asked something stays with the agent.
  const { data: last } = await supabase.from("landlord_agent_messages").select("sender, body, created_at")
    .eq("landlord_id", userId).eq("listing_id", listingId).order("created_at", { ascending: false }).limit(2);
  const lastAgent = (last ?? []).find((m) => m.sender === "agent");
  try {
    const { parsed } = await parseStructured({
      model: HAIKU, listingId, kind: "route_landlord", tag: "landlord-route", maxTokens: 120,
      system: [
        "A landlord is typing in one chat about their rental listing. Two kinds of message arrive in that chat: questions from students (relayed by Proxy, the listing's assistant), and the landlord's own talk with Proxy about the listing (updates, changes, questions about what Proxy knows).",
        "Decide whether the landlord's new message is meant for a student who asked one of the open questions, and if so which one.",
        "It is for a student when it answers an open question (even partly, even in a word like \"yes\" or \"no\" right after that question), or when it asks something back that only the student could answer: about their situation, belongings, plans, needs or preferences (\"what kind of charger is it?\", \"how big is the dog?\", \"when do you want to move in?\"). A question back is usually about the most recent open question unless it clearly fits another.",
        "It is for Proxy, not a student, when it changes or adds listing details (\"raise the rent by $50\", \"parking is now $40\"), asks what Proxy knows or has on file (\"what do you have on parking?\"), or replies to something Proxy itself just asked the landlord.",
        "When it fits no open question, answer 0.",
        "Say whether you are sure. Short replies (\"yes\", \"next week\", \"$50\") with more than one open question, or a message that could be either a student's answer or a note for Proxy, are not sure.",
      ].join(" "),
      messages: [{ role: "user", content: `Open student questions:\n${open.map((q, i) => `${i + 1}. ${q.question}${i === open.length - 1 ? " (most recent)" : ""}`).join("\n")}${lastAgent && (!last[0] || last[0].sender === "agent") ? `\n\nThe agent's last message to the landlord: "${lastAgent.body.slice(0, 500)}"` : ""}\n\nThe landlord's new message:\n"""\n${body.slice(0, 2000)}\n"""` }],
      schema: Route,
    });
    const q = open[(parsed?.question_number ?? 0) - 1];
    const sure = parsed?.sure === true;
    return q ? { questionId: q.id, question: q.question, sure } : { questionId: null, sure };
  } catch {
    return { questionId: null, sure: false };
  }
}

const note = (userId, listingId, row) => supabase.from("landlord_agent_messages").insert({ landlord_id: userId, listing_id: listingId, ...row }).select("id").single();

/*
 * Send what the landlord wrote: to the question it was aimed at, or to the
 * agent. Either way it is saved, so the chat reads the same everywhere.
 */
export async function sendLandlordMessage({ userId, isAdmin = false, listingId, text, questionId = null, tourId = null }) {
  const body = String(text ?? "").trim().slice(0, 4000);
  if (!body) return { error: "Say something first." };
  if (tourId) {
    // A reply on a tour card goes to the student in their direct chat; a copy stays on the card.
    const r = await landlordAct({ tourId, landlordId: userId, action: "message", body });
    if (r.error) return { error: r.error, status: r.status };
    await note(userId, listingId, { sender: "landlord", body, tour_id: tourId });
    return { kind: "tour", threadId: r.threadId };
  }
  if (questionId) {
    // Nothing but contact details: nothing to pass on. Proxy says why, in the chat.
    if (screenLandlordText(body).onlyContact) {
      await note(userId, listingId, { sender: "landlord", body });
      await note(userId, listingId, { sender: "agent", body: `I can't pass contact details along. If the student is interested in the listing, you'll be put in touch once they book a tour. If you'd like to answer their question, send me the answer and I'll pass it on.` });
      return { kind: "contact_only" };
    }
    const r = await answerQuestion({ questionId, landlordUserId: userId, body, done: null, via: "app" });
    if (r.error) return { error: r.error, status: r.status };
    await note(userId, listingId, { sender: "landlord", body, question_id: questionId });
    return { kind: "question", replyKind: r.kind, status: r.question.status, screened: r.screened, relayedTo: r.relayedTo };
  }
  const { data: past } = await supabase.from("landlord_agent_messages").select("sender, body, question_id, tour_id")
    .eq("landlord_id", userId).eq("listing_id", listingId).order("created_at", { ascending: false }).limit(12);
  const history = (past ?? []).reverse().filter((m) => !m.question_id && !m.tour_id).map((m) => ({ role: m.sender === "agent" ? "assistant" : "user", content: m.body }));
  const r = await agentChat({ listingId, userId, isAdmin, message: body, history });
  if (r.error) return { error: r.error };
  await note(userId, listingId, { sender: "landlord", body });
  await note(userId, listingId, { sender: "agent", body: r.reply, proposal: r.hasChanges ? r.proposal : null, proposal_status: r.hasChanges ? "open" : null });
  return { kind: "agent" };
}

/* The landlord confirmed (or cancelled) the changes an agent message proposed. */
export async function decideAgentProposal({ userId, isAdmin = false, listingId, messageId, confirm }) {
  const { data: m } = await supabase.from("landlord_agent_messages").select("id, proposal, proposal_status")
    .eq("id", messageId).eq("landlord_id", userId).eq("listing_id", listingId).maybeSingle();
  if (!m || m.proposal_status !== "open") return { error: "Those changes were already handled." };
  // Claim it first so a double click cannot apply it twice.
  const { data: claimed } = await supabase.from("landlord_agent_messages").update({ proposal_status: confirm ? "applied" : "cancelled" })
    .eq("id", m.id).eq("proposal_status", "open").select("id");
  if (!claimed?.length) return { error: "Those changes were already handled." };
  if (!confirm) {
    await note(userId, listingId, { sender: "agent", body: "Okay, I left everything as it was." });
    return { ok: true };
  }
  const r = await confirmProposal({ listingId, userId, isAdmin, proposal: m.proposal });
  const lines = [...(r.applied ?? []).map((a) => (/^(Saved|Already known|Removed):/.test(a) ? a : `Done: ${a}`)), ...(r.held ?? []), ...(r.errors ?? []).map((e) => `Not done: ${e}`)];
  await note(userId, listingId, { sender: "agent", body: lines.join("\n") || "Nothing to do." });
  return { ok: true, ...r };
}
