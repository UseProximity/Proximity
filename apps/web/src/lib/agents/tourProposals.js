/*
 * Tour times suggested in a tour's direct chat (Wyatt, 2026-11-02).
 *
 * Each message sent in a chat a tour opened is read once, briefly (Haiku):
 * does it suggest a specific day and time for the tour ("can we do 1pm
 * Thursday?")? If so the message carries the suggestion
 * (chat_messages.metadata.tourProposal) and the other side is asked, under
 * that message and in their email, whether to book or move the tour to it.
 * Confirming books it whether or not the tour was confirmed before; the old
 * time, if any, is replaced, both sides are told and get a new invite.
 *
 * A suggestion is only ever confirmed by the person it was made to, and a
 * newer one in the same chat replaces any that are still open.
 */
import { createHmac } from "crypto";
import { z } from "zod";
import supabase from "@/lib/supabase";
import { parseStructured, HAIKU } from "./model";
import { chicagoToUtc, fmtTourTime, TZ } from "./tourTime";
import { releaseTourTime, studentClash } from "./tours";
import { notifyTourConfirmed } from "./tourNotify";
import { postProxyMessage } from "./threads";

const OPEN = ["requested", "proposed", "messaging", "confirmed"];
const HORIZON_MS = 60 * 24 * 3600 * 1000;

const Proposal = z.object({
  proposes_time: z.boolean().describe("True only if this message suggests one specific day and start time for the tour (or a new time for it). Questions about availability without a time, or vague times (\"sometime next week\"), are false."),
  date: z.string().nullable().describe("The suggested day as YYYY-MM-DD, worked out from today's date; null when proposes_time is false."),
  time: z.string().nullable().describe("The suggested start time as 24-hour HH:MM; null when proposes_time is false."),
});

async function tourForThread(threadId) {
  const { data } = await supabase.from("tour_requests").select("id, listing_id, student_id, landlord_id, status, confirmed_slot, proxy_thread_id, thread_id")
    .eq("thread_id", threadId).in("status", OPEN).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

/*
 * Read one just-sent message. Never throws: a message that can't be read
 * is simply not a suggestion.
 */
export async function detectTourProposal({ threadId, messageId, senderId, body }) {
  try {
    const text = String(body ?? "").trim();
    if (!threadId || !messageId || !senderId || text.length < 4 || !/\d|noon|morning|afternoon|evening|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(text)) return null;
    const tour = await tourForThread(threadId);
    if (!tour || ![tour.student_id, tour.landlord_id].includes(senderId)) return null;
    const recipient = senderId === tour.student_id ? tour.landlord_id : tour.student_id;

    const now = new Date();
    const today = now.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const { parsed } = await parseStructured({
      model: HAIKU, listingId: tour.listing_id, kind: "tour_time", tag: "tour-proposal", maxTokens: 120,
      system: "You read one chat message between a student and a landlord arranging an apartment tour, and say whether it suggests a specific day and start time for the tour. Times are in Central time.",
      messages: [{ role: "user", content: `Today is ${today}.${tour.confirmed_slot ? ` The tour is currently booked for ${fmtTourTime(tour.confirmed_slot)}.` : ""}\n\nMessage: "${text.slice(0, 1000)}"` }],
      schema: Proposal,
    });
    if (!parsed?.proposes_time || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date ?? "") || !/^\d{1,2}:\d{2}$/.test(parsed.time ?? "")) return null;
    const [y, m, d] = parsed.date.split("-").map(Number);
    const [h, min] = parsed.time.split(":").map(Number);
    if (h > 23 || min > 59) return null;
    const at = new Date(chicagoToUtc(y, m, d, h).getTime() + min * 60000);
    if (at.getTime() < now.getTime() || at.getTime() > now.getTime() + HORIZON_MS) return null;
    const iso = at.toISOString();
    if (tour.confirmed_slot && Date.parse(tour.confirmed_slot) === at.getTime()) return null;

    const proposal = { tourId: tour.id, at: iso, text: fmtTourTime(iso), by: senderId, for: recipient, status: "pending", rebook: tour.status === "confirmed" };
    // A newer suggestion replaces any still open in this chat.
    await supersede(threadId, messageId);
    const { data: msg } = await supabase.from("chat_messages").select("metadata").eq("id", messageId).maybeSingle();
    await supabase.from("chat_messages").update({ metadata: { ...(msg?.metadata ?? {}), tourProposal: proposal } }).eq("id", messageId);
    return proposal;
  } catch (err) {
    console.error("[tours] reading a message for a tour time failed:", err?.message ?? err);
    return null;
  }
}

async function supersede(threadId, exceptId) {
  const { data } = await supabase.from("chat_messages").select("id, metadata").eq("thread_id", threadId)
    .eq("metadata->tourProposal->>status", "pending").neq("id", exceptId);
  for (const m of data ?? []) {
    await supabase.from("chat_messages").update({ metadata: { ...m.metadata, tourProposal: { ...m.metadata.tourProposal, status: "replaced" } } }).eq("id", m.id);
  }
}

/* The open suggestion waiting on this person in this chat, for their email. */
export async function pendingProposalFor({ threadId, userId }) {
  const { data } = await supabase.from("chat_messages").select("id, metadata").eq("thread_id", threadId)
    .eq("metadata->tourProposal->>status", "pending").eq("metadata->tourProposal->>for", userId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { messageId: data.id, ...data.metadata.tourProposal } : null;
}

/* A key for the email's Confirm link, bound to the message and its recipient. */
export function proposalKey({ messageId, userId }) {
  const secret = process.env.CHAT_REPLY_SECRET;
  if (!secret || !messageId || !userId) return null;
  return createHmac("sha256", secret).update(`proposal:${messageId}:${userId}`).digest("hex").slice(0, 32);
}

/*
 * The recipient answers a suggestion. "confirm" books or moves the tour to
 * that time; "decline" leaves the tour as it was. Returns { proposal } or
 * { error, status }.
 */
export async function respondToProposal({ messageId, userId, decision }) {
  const { data: msg } = await supabase.from("chat_messages").select("id, thread_id, metadata").eq("id", messageId).maybeSingle();
  const p = msg?.metadata?.tourProposal;
  if (!p) return { error: "That suggestion was not found.", status: 404 };
  if (p.for !== userId) return { error: "Only the person it was suggested to can answer it.", status: 403 };
  if (p.status !== "pending") return { error: p.status === "confirmed" ? "That time is already booked." : "That suggestion is no longer open.", status: 409 };
  const save = (status) => supabase.from("chat_messages").update({ metadata: { ...msg.metadata, tourProposal: { ...p, status, answeredAt: new Date().toISOString() } } }).eq("id", messageId);

  if (decision !== "confirm") {
    await save("declined");
    return { proposal: { ...p, status: "declined" } };
  }
  if (Date.parse(p.at) < Date.now()) return { error: "That time has already passed.", status: 409 };
  const { data: t } = await supabase.from("tour_requests").select("*").eq("id", p.tourId).maybeSingle();
  if (!t || !OPEN.includes(t.status)) return { error: "This tour is no longer open.", status: 409 };
  const clash = await studentClash({ tour: t, iso: p.at });
  if (clash) return { error: clash, status: 409 };

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase.from("tour_requests").update({
    status: "confirmed", confirmed_slot: p.at, confirmed_by: userId, confirmed_at: now, last_activity_at: now,
  }).eq("id", t.id).in("status", OPEN).select("id").maybeSingle();
  if (error || !updated) return { error: "This tour just changed. Refresh to see where it stands.", status: 409 };
  await save("confirmed");
  await releaseTourTime(t, p.at).catch((err) => console.error("[tours] releasing the time failed:", err?.message ?? err));
  if (t.proxy_thread_id) {
    await postProxyMessage({ threadId: t.proxy_thread_id, listingId: t.listing_id, type: "proxy_note",
      body: `${p.rebook ? "Your tour has moved to" : "Your tour is confirmed for"} ${p.text}. You can keep talking with the landlord in your direct chat.`,
      metadata: { tourId: t.id, confirmed: true, link: { href: `/?messages=1&thread=${t.thread_id}`, label: "Open the chat with the landlord" } } }).catch(() => {});
  }
  await notifyTourConfirmed({ tourId: t.id }).catch((err) => console.error("[tours] confirm email failed:", err?.message ?? err));
  return { proposal: { ...p, status: "confirmed" } };
}

