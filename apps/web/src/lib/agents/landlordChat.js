/*
 * The landlord's Proxy chat, one per listing (Wyatt, 2026-10-27, round 6).
 *
 * Built from what already exists, with no thread of its own: each question
 * Proxy sent this landlord, the back-and-forth on it, and each tour request
 * on the listing, in time order. The landlord replies in one box and the
 * reply goes to the question it is aimed at (answerQuestion classifies it as
 * an answer, a question back, or both). Shown in the landlord's Messages
 * (Proxy tab), the dashboard's Questions tab, and under the Agent chat.
 *
 * Never the student's name on questions; tours carry the name, as before.
 */
import supabase from "@/lib/supabase";
import { listLandlordTours } from "./tours";

const fail = (where, error) => new Error(`${where}: ${error.message}`);
const OPEN_TOURS = ["requested", "proposed", "messaging"];

function leaseLabel(ul) {
  if (!ul) return null;
  const u = ul.listing_units;
  const unit = u ? (u.name || `${u.bedrooms ?? "?"} bed, ${u.bathrooms ?? "?"} bath`) : "a unit";
  return `${unit}${ul.rent ? ` at $${Number(ul.rent).toLocaleString("en-US")}/mo` : ""}`;
}

/* Listings this landlord has Proxy activity on, with what is waiting. */
export async function landlordProxyOverview(userId) {
  const [{ data: qs, error }, tours] = await Promise.all([
    supabase.from("listing_questions").select("listing_id, status, pending_clarifier, question, created_at, last_activity_at, listings!listing_id(title, address, listing_images(url, sort_order))")
      .eq("owner_id", userId).in("status", ["open", "answered"]).order("last_activity_at", { ascending: false }).limit(500),
    listLandlordTours(userId),
  ]);
  if (error) throw fail("landlord overview", error);
  const rows = new Map();
  const touch = (listingId, title, address, images, at, text) => {
    if (!rows.has(listingId)) {
      const img = (images ?? []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.url ?? null;
      rows.set(listingId, { listingId, title: title || address || "Listing", address: address ?? null, image: img, openQuestions: 0, openTours: 0, lastAt: at, lastText: text });
    }
    const r = rows.get(listingId);
    if (at > r.lastAt) { r.lastAt = at; r.lastText = text; }
    return r;
  };
  for (const q of qs ?? []) {
    const r = touch(q.listing_id, q.listings?.title, q.listings?.address, q.listings?.listing_images, q.last_activity_at ?? q.created_at, `A student asked: ${q.question}`);
    if (q.status === "open" && !q.pending_clarifier) r.openQuestions++;
  }
  for (const t of tours) {
    const r = touch(t.listingId, t.listingTitle, t.listingAddress, null, t.lastActivityAt ?? t.createdAt, `${t.studentName} wants to tour`);
    if (t.status === "requested") r.openTours++;
  }
  return [...rows.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

/* What needs the landlord: open questions not waiting on a student, plus tour requests. */
export async function landlordWaitingCount(userId) {
  const [{ count: q }, { count: t }] = await Promise.all([
    supabase.from("listing_questions").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("status", "open").eq("pending_clarifier", false),
    supabase.from("tour_requests").select("id", { count: "exact", head: true }).eq("landlord_id", userId).eq("status", "requested"),
  ]);
  return { questions: q ?? 0, tours: t ?? 0, total: (q ?? 0) + (t ?? 0) };
}

/* One listing's chat: questions with their exchange, and tours, oldest first. */
export async function landlordProxyTimeline(userId, listingId) {
  const [{ data: listing }, { data: qs, error }, tours] = await Promise.all([
    supabase.from("listings").select("id, title, address").eq("id", listingId).maybeSingle(),
    supabase.from("listing_questions").select("id, lease_id, status, question, context, asked_count, answer, answered_at, pending_clarifier, created_at, last_activity_at, unit_leases!lease_id(rent, listing_units!unit_id(name, bedrooms, bathrooms))")
      .eq("owner_id", userId).eq("listing_id", listingId).in("status", ["open", "answered"]).order("created_at", { ascending: true }).limit(200),
    listLandlordTours(userId),
  ]);
  if (error) throw fail("landlord timeline", error);
  const ids = (qs ?? []).map((q) => q.id);
  const { data: msgs } = ids.length
    ? await supabase.from("listing_question_messages").select("question_id, sender, body, via, created_at").in("question_id", ids).order("created_at", { ascending: true })
    : { data: [] };
  const byQ = new Map();
  for (const m of msgs ?? []) { if (!byQ.has(m.question_id)) byQ.set(m.question_id, []); byQ.get(m.question_id).push(m); }
  const items = [
    ...(qs ?? []).map((q) => ({
      kind: "question", id: q.id, at: q.created_at, status: q.status, question: q.question, context: q.context,
      lease: leaseLabel(q.unit_leases), askedCount: q.asked_count, pendingClarifier: q.pending_clarifier, answer: q.answer, answeredAt: q.answered_at,
      messages: (byQ.get(q.id) ?? []).map((m) => ({ sender: m.sender, body: m.body, via: m.via, at: m.created_at })),
    })),
    ...tours.filter((t) => t.listingId === listingId).map((t) => ({ kind: "tour", id: t.id, at: t.createdAt, tour: t })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));
  const open = items.filter((i) => i.kind === "question" && i.status === "open");
  return {
    listing: listing ? { id: listing.id, title: listing.title || listing.address || "Listing", address: listing.address } : null,
    items,
    openQuestions: open.length,
    openTours: items.filter((i) => i.kind === "tour" && OPEN_TOURS.includes(i.tour.status)).length,
  };
}
