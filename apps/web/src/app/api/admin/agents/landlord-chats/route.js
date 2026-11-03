export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";
import { fmtTourTime } from "@/lib/agents/tourTime";

/*
 * Landlords' chats with their listing's agent, for the admin Conversations
 * view (Wyatt, 2026-11-01): one chat per landlord per listing, made of the
 * questions Proxy sent them, the tour requests students made, and what they
 * told the agent directly (lib/agents/landlordChat.js builds the landlord's
 * own view of the same thing).
 *
 *   GET                                  every chat, newest activity first
 *   GET ?landlordId=<id>&listingId=<id>  one chat in full, oldest first
 *
 * Unlike the landlord's view, the admin sees which student and thread each
 * message came from. Read only. Honours x-db-target like the other admin
 * reads.
 *
 * @auth admin
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

async function fetchAll(query) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

const later = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

async function namesFor(supabase, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const users = await fetchAll(supabase.from("users").select("id, name, email").in("id", list));
  return new Map(users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email }]));
}

async function listingsFor(supabase, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await fetchAll(supabase.from("listings").select("id, title, address").in("id", list));
  return new Map(rows.map((l) => [l.id, l]));
}

async function overview(supabase) {
  const [questions, tours, notes] = await Promise.all([
    fetchAll(supabase.from("listing_questions").select("owner_id, listing_id, status, pending_clarifier, created_at, last_activity_at").not("owner_id", "is", null)),
    fetchAll(supabase.from("tour_requests").select("landlord_id, listing_id, status, created_at, last_activity_at").not("landlord_id", "is", null)),
    fetchAll(supabase.from("landlord_agent_messages").select("landlord_id, listing_id, created_at")),
  ]);
  const chats = new Map();
  const touch = (landlordId, listingId, at) => {
    const key = `${landlordId}:${listingId}`;
    if (!chats.has(key)) chats.set(key, { key, landlordId, listingId, questions: 0, openQuestions: 0, tours: 0, openTours: 0, notes: 0, lastAt: null });
    const c = chats.get(key);
    c.lastAt = later(c.lastAt, at);
    return c;
  };
  for (const q of questions) {
    const c = touch(q.owner_id, q.listing_id, q.last_activity_at ?? q.created_at);
    c.questions++;
    if (q.status === "open" && !q.pending_clarifier) c.openQuestions++;
  }
  for (const t of tours) {
    const c = touch(t.landlord_id, t.listing_id, t.last_activity_at ?? t.created_at);
    c.tours++;
    if (["requested", "proposed"].includes(t.status)) c.openTours++;
  }
  for (const m of notes) touch(m.landlord_id, m.listing_id, m.created_at).notes++;

  const rows = [...chats.values()];
  const [people, listings] = await Promise.all([
    namesFor(supabase, rows.map((r) => r.landlordId)),
    listingsFor(supabase, rows.map((r) => r.listingId)),
  ]);
  return rows
    .map((r) => ({ ...r, landlord: people.get(r.landlordId) ?? null, listing: listings.get(r.listingId) ?? null }))
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

async function oneChat(supabase, landlordId, listingId) {
  const [questions, tours, notes, listings, people] = await Promise.all([
    fetchAll(supabase.from("listing_questions")
      .select("id, status, question, context, asked_count, answer, answered_at, pending_clarifier, created_at, last_activity_at")
      .eq("owner_id", landlordId).eq("listing_id", listingId).order("created_at", { ascending: true })),
    fetchAll(supabase.from("tour_requests")
      .select("id, status, student_id, student_slots, confirmed_slot, thread_id, proxy_thread_id, created_at, last_activity_at, cancelled_by")
      .eq("landlord_id", landlordId).eq("listing_id", listingId).order("created_at", { ascending: true })),
    fetchAll(supabase.from("landlord_agent_messages")
      .select("id, sender, body, question_id, tour_id, proposal_status, created_at")
      .eq("landlord_id", landlordId).eq("listing_id", listingId).order("created_at", { ascending: true })),
    listingsFor(supabase, [listingId]),
    namesFor(supabase, [landlordId]),
  ]);
  const ids = questions.map((q) => q.id);
  const [messages, waiters] = ids.length
    ? await Promise.all([
        fetchAll(supabase.from("listing_question_messages").select("question_id, sender, kind, thread_id, user_id, body, raw_body, via, created_at").in("question_id", ids).order("created_at", { ascending: true })),
        fetchAll(supabase.from("listing_question_waiters").select("question_id, thread_id, user_id, visitor_id, relayed_at").in("question_id", ids)),
      ])
    : [[], []];
  const students = await namesFor(supabase, [
    ...messages.map((m) => m.user_id), ...waiters.map((w) => w.user_id), ...tours.map((t) => t.student_id),
  ]);

  const byQuestion = new Map();
  for (const m of messages) {
    if (!byQuestion.has(m.question_id)) byQuestion.set(m.question_id, []);
    byQuestion.get(m.question_id).push({
      from: m.sender === "landlord" ? "landlord" : "student",
      kind: m.kind,
      body: m.raw_body || m.body,
      via: m.via === "email" ? "email" : "app",
      student: m.user_id ? students.get(m.user_id) ?? { id: m.user_id } : null,
      threadId: m.thread_id,
      at: m.created_at,
    });
  }
  const waitersByQuestion = new Map();
  for (const w of waiters) {
    if (!waitersByQuestion.has(w.question_id)) waitersByQuestion.set(w.question_id, []);
    waitersByQuestion.get(w.question_id).push({
      threadId: w.thread_id,
      student: w.user_id ? students.get(w.user_id) ?? { id: w.user_id } : null,
      visitorId: w.user_id ? null : w.visitor_id,
      relayedAt: w.relayed_at,
    });
  }

  const items = [
    ...questions.map((q) => ({
      kind: "question",
      id: q.id,
      at: later(q.last_activity_at, q.created_at),
      askedAt: q.created_at,
      status: q.status,
      waitingOnStudent: q.pending_clarifier === true,
      question: q.question,
      context: q.context,
      askedCount: q.asked_count ?? 1,
      answer: q.answer,
      answeredAt: q.answered_at,
      exchange: byQuestion.get(q.id) ?? [],
      askedBy: waitersByQuestion.get(q.id) ?? [],
    })),
    ...tours.map((t) => ({
      kind: "tour",
      id: t.id,
      at: later(t.last_activity_at, t.created_at),
      status: t.status,
      student: students.get(t.student_id) ?? { id: t.student_id },
      slots: (t.student_slots ?? []).length,
      confirmedSlot: t.confirmed_slot,
      confirmedText: t.confirmed_slot ? fmtTourTime(t.confirmed_slot) : null,
      cancelledBy: t.cancelled_by ? (t.cancelled_by === landlordId ? "landlord" : "student") : null,
      directThreadId: t.thread_id,
      proxyThreadId: t.proxy_thread_id,
    })),
    ...notes.map((m) => ({
      kind: "note",
      id: m.id,
      at: m.created_at,
      from: m.sender === "landlord" ? "landlord" : "agent",
      body: m.body,
      questionId: m.question_id,
      tourId: m.tour_id,
      proposalStatus: m.proposal_status,
    })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));

  return {
    landlord: people.get(landlordId) ?? { id: landlordId },
    listing: listings.get(listingId) ?? { id: listingId },
    items,
  };
}

export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const supabase = getSupabaseClient(getDbTarget(req));
  const params = new URL(req.url).searchParams;
  const landlordId = params.get("landlordId");
  const listingId = params.get("listingId");

  try {
    if (landlordId || listingId) {
      if (!UUID.test(landlordId ?? "") || !UUID.test(listingId ?? "")) {
        return Response.json({ error: "landlordId and listingId are required" }, { status: 400 });
      }
      return Response.json(await oneChat(supabase, landlordId, listingId));
    }
    return Response.json(await overview(supabase));
  } catch (err) {
    console.error("GET /api/admin/agents/landlord-chats failed:", err);
    return Response.json({ error: "Could not load landlord agent chats" }, { status: 500 });
  }
}
