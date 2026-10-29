/*
 * Tour scheduling (PRD v3, milestone 5; reworked by Wyatt, 2026-10-27, round 6).
 *
 * The student paints the hours they can tour on the next seven real dates,
 * from the calendar button in the Proxy chat input. The request posts their
 * availability into the Proxy thread as plain ranges ("Sunday 11/1
 * 8am-2pm, 3pm-4pm") and Proxy confirms it went to the landlord who holds
 * the lease. The landlord either:
 *
 *   confirm   picks one of the student's days and types a start time; the
 *             site checks it sits inside the student's window and at least
 *             10 minutes before it ends
 *   message   can't make it, and writes to the student instead
 *
 * Either way a direct student-landlord chat opens (one per student, listing
 * and landlord; contact details and links are not stripped there), and
 * Proxy tells the student in the Proxy thread with a link to it. Contact
 * details are never handed over automatically. The landlord never joins
 * the Proxy thread.
 *
 * Reminders: landlord at day 1 and 3, the student told on day 5, both
 * reminded the day before a confirmed tour.
 */
import supabase from "@/lib/supabase";
import { postProxyMessage, postMessage } from "./threads";
import { shortDate } from "./sections";
import {
  notifyTourRequested, notifyTourProposed, notifyTourConfirmed, notifyTourCancelled, notifyTourReminder, notifyTourNoAnswer,
} from "./tourNotify";

import { fmtSlot, normalizePattern, slotsFromPattern, availabilityText, availabilityDays, checkTourTime, fmtTourTime, chicagoParts, DAYS } from "./tourTime";

export { fmtSlot, normalizePattern, slotsFromPattern };

const fail = (where, error) => new Error(`${where}: ${error.message}`);

function validSlots(list, { max = 60 } = {}) {
  const now = Date.now();
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const t = Date.parse(s);
    if (!Number.isFinite(t) || t < now) continue;
    const iso = new Date(t).toISOString();
    if (!out.includes(iso)) out.push(iso);
    if (out.length >= max) break;
  }
  return out.sort();
}

/* ---- availability ----------------------------------------------------- */

export async function getAvailability(userId) {
  const { data } = await supabase.from("student_availability").select("pattern, updated_at").eq("user_id", userId).maybeSingle();
  return data?.pattern ?? {};
}

export async function saveAvailability(userId, pattern) {
  const clean = normalizePattern(pattern);
  const { error } = await supabase.from("student_availability").upsert({ user_id: userId, pattern: clean }, { onConflict: "user_id" });
  if (error) throw fail("availability", error);
  return clean;
}

/* ---- requests --------------------------------------------------------- */

const TOUR_SELECT = "id, listing_id, lease_id, student_id, landlord_id, status, student_slots, landlord_slots, confirmed_slot, confirmed_at, student_contact, landlord_contact, student_phone, proxy_thread_id, thread_id, cancelled_by, cancel_reason, created_at, last_activity_at, listings!listing_id(title, address), unit_leases!lease_id(rent, owner_id, listing_units!unit_id(name, bedrooms, bathrooms))";

function shape(t, viewer) {
  const unit = t.unit_leases?.listing_units;
  const unitLabel = unit ? (unit.name || `${unit.bedrooms ?? "?"} bed, ${unit.bathrooms ?? "?"} bath`) : null;
  return {
    id: t.id, listingId: t.listing_id, leaseId: t.lease_id, status: t.status,
    listingTitle: t.listings?.title || t.listings?.address || "Listing", listingAddress: t.listings?.address ?? null,
    lease: unitLabel ? { unit: unitLabel, rent: t.unit_leases?.rent ?? null } : null,
    studentSlots: t.student_slots ?? [], landlordSlots: t.landlord_slots ?? [],
    confirmedSlot: t.confirmed_slot, confirmedAt: t.confirmed_at,
    availability: availabilityDays(t.student_slots ?? []),
    availabilityText: availabilityText(t.student_slots ?? []),
    confirmedText: t.confirmed_slot ? fmtTourTime(t.confirmed_slot) : null,
    threadId: t.thread_id, proxyThreadId: t.proxy_thread_id,
    cancelledByMe: viewer === "student" ? t.cancelled_by === t.student_id : t.cancelled_by === t.landlord_id,
    createdAt: t.created_at, lastActivityAt: t.last_activity_at,
  };
}

async function resolveLandlord({ listingId, leaseId }) {
  if (leaseId) {
    const { data: lease } = await supabase.from("unit_leases").select("owner_id, contact_email, contact_name").eq("id", leaseId).maybeSingle();
    if (lease?.owner_id) return lease.owner_id;
  }
  const { data: owner } = await supabase.rpc("fn_chat_primary_landlord_id", { p_listing_id: listingId });
  if (owner) return owner;
  const { data: listing } = await supabase.from("listings").select("contact_email, contact_name").eq("id", listingId).maybeSingle();
  if (listing?.contact_email) {
    const { data } = await supabase.rpc("fn_chat_find_or_create_contact_user", { p_email: listing.contact_email, p_name: listing.contact_name ?? null });
    if (data) return data;
  }
  return null;
}

/* The weekday pattern implied by real-date slots, saved for next time. */
function patternFromSlots(slots) {
  const pattern = {};
  for (const iso of slots) {
    const p = chicagoParts(new Date(iso));
    if (!DAYS.includes(p.weekday)) continue;
    pattern[p.weekday] = [...new Set([...(pattern[p.weekday] ?? []), p.h])].sort((x, y) => x - y);
  }
  return pattern;
}

async function postAvailability({ t, listingId, proxyThreadId, studentId, clean, updated = false }) {
  if (!proxyThreadId) return;
  const text = availabilityText(clean);
  await postMessage({ threadId: proxyThreadId, listingId, senderId: studentId, type: "text", body: `${updated ? "Here's my updated availability for a tour:" : "I'd like to tour. Here's when I'm available:"}\n${text}`, metadata: { tourId: t.id, availability: true } });
  await postProxyMessage({ threadId: proxyThreadId, listingId, type: "proxy_note",
    body: updated
      ? "Got it. I've sent the landlord your updated times and will let you know as soon as they pick one."
      : "Got it. I've sent your availability to the landlord and will let you know as soon as they pick a time.",
    metadata: { tourId: t.id } });
}

export async function requestTour({ listingId, leaseId = null, studentId, slots, proxyThreadId = null }) {
  const clean = validSlots(slots);
  if (!clean.length) return { error: "Pick at least one time that works for you.", status: 400 };
  const { data: owned } = await supabase.from("listing_landlords").select("listing_id").eq("listing_id", listingId).eq("user_id", studentId).limit(1);
  if (owned?.length) return { error: "You cannot book a tour of your own listing.", status: 400 };
  const landlordId = await resolveLandlord({ listingId, leaseId });
  if (!landlordId) return { error: "This listing has nobody to book a tour with yet.", status: 409 };

  const { data: tour, error } = await supabase.from("tour_requests").insert({
    listing_id: listingId, lease_id: leaseId, student_id: studentId, landlord_id: landlordId,
    status: "requested", student_slots: clean, proxy_thread_id: proxyThreadId,
  }).select(TOUR_SELECT).single();
  if (error) {
    if (error.code === "23505") return { error: "You already have an open tour request here. Use the calendar button to change your times.", status: 409 };
    throw fail("tour create", error);
  }
  await saveAvailability(studentId, patternFromSlots(clean)).catch(() => {});
  await postAvailability({ t: tour, listingId, proxyThreadId, studentId, clean });
  await notifyTourRequested({ tourId: tour.id }).catch((err) => console.error("[tours] request alert failed:", err?.message ?? err));
  return { tour: shape(tour, "student") };
}

async function load(tourId) {
  const { data, error } = await supabase.from("tour_requests").select(TOUR_SELECT).eq("id", tourId).maybeSingle();
  if (error) throw fail("tour", error);
  return data ?? null;
}

/*
 * The direct chat between the student and this landlord about this listing
 * (the Landlords tab), opened by a confirmed tour or a landlord reaching
 * out. Reused when one exists; contact details and links are allowed in it.
 */
async function openDirectThread(t) {
  const { data: existing } = await supabase.from("chat_threads").select("id").eq("listing_id", t.listing_id)
    .eq("landlord_id", t.landlord_id).eq("interested_user_id", t.student_id).is("deleted_at", null).limit(1).maybeSingle();
  let threadId = existing?.id ?? null;
  if (!threadId) {
    const { data: typeId } = await supabase.rpc("fn_chat_direct_type_id");
    const { data: created, error } = await supabase.from("chat_threads").insert({
      thread_type_id: typeId, listing_id: t.listing_id, landlord_id: t.landlord_id, interested_user_id: t.student_id,
      lease_id: t.lease_id, subject: t.listings?.title || t.listings?.address || "Listing inquiry", unrestricted: true,
    }).select("id").single();
    if (error) throw fail("direct thread", error);
    threadId = created.id;
    await supabase.from("chat_participants").upsert(
      [{ thread_id: threadId, user_id: t.student_id }, { thread_id: threadId, user_id: t.landlord_id }],
      { onConflict: "thread_id,user_id", ignoreDuplicates: true },
    );
  } else {
    await supabase.from("chat_threads").update({ unrestricted: true }).eq("id", threadId);
  }
  return threadId;
}

const chatLink = (threadId) => `/?messages=1&thread=${threadId}`;

async function confirm(t, iso, byUserId) {
  const now = new Date().toISOString();
  const when = fmtTourTime(iso);
  const threadId = await openDirectThread(t);
  const { data: updated, error } = await supabase.from("tour_requests").update({
    status: "confirmed", confirmed_slot: iso, confirmed_by: byUserId, confirmed_at: now, thread_id: threadId, last_activity_at: now,
  }).eq("id", t.id).select(TOUR_SELECT).single();
  if (error) throw fail("tour confirm", error);
  await postMessage({ threadId, listingId: t.listing_id, senderId: t.landlord_id, type: "text", body: `Your tour is confirmed for ${when}. Message me here if anything changes.`, metadata: { tourId: t.id, confirmed: true } });
  if (t.proxy_thread_id) {
    await postProxyMessage({ threadId: t.proxy_thread_id, listingId: t.listing_id, type: "proxy_note",
      body: `Your tour is confirmed for ${when}. The landlord can message you directly now, and you can reply to them there.`,
      metadata: { tourId: t.id, confirmed: true, link: { href: chatLink(threadId), label: "Open the chat with the landlord" } } });
  }
  await notifyTourConfirmed({ tourId: t.id }).catch((err) => console.error("[tours] confirm alert failed:", err?.message ?? err));
  return updated;
}

export async function landlordAct({ tourId, landlordId, action, day = null, time = null, body = "" }) {
  const t = await load(tourId);
  if (!t) return { error: "Tour request not found", status: 404 };
  if (t.landlord_id !== landlordId) return { error: "This request went to another landlord", status: 403 };
  // A confirmed tour can still be written about (the Reply on its card), straight into the direct chat.
  const writable = action === "message" && t.status === "confirmed";
  if (!writable && !["requested", "proposed", "messaging"].includes(t.status)) return { error: "This request is no longer open", status: 409 };
  const now = new Date().toISOString();
  if (action === "confirm") {
    const checked = checkTourTime(t.student_slots ?? [], day, time);
    if (checked.error) return { error: checked.error, status: 400 };
    const updated = await confirm(t, checked.iso, landlordId);
    return { tour: shape(updated, "landlord") };
  }
  if (action === "message") {
    const text = String(body ?? "").trim().slice(0, 4000);
    if (!text) return { error: "Write a message to the student first.", status: 400 };
    const threadId = await openDirectThread(t);
    await postMessage({ threadId, listingId: t.listing_id, senderId: landlordId, type: "text", body: text, metadata: { tourId: t.id } });
    // Already talking (or confirmed): the message is all; the student heard the rest the first time.
    const first = !["messaging", "confirmed"].includes(t.status);
    const { data: updated, error } = await supabase.from("tour_requests").update({ status: first ? "messaging" : t.status, thread_id: threadId, last_activity_at: now }).eq("id", t.id).select(TOUR_SELECT).single();
    if (error) throw fail("tour message", error);
    if (!first) return { tour: shape(updated, "landlord"), threadId };
    if (t.proxy_thread_id) {
      await postProxyMessage({ threadId: t.proxy_thread_id, listingId: t.listing_id, type: "proxy_note",
        body: "The landlord messaged you directly about your tour. You can reply to them there.",
        metadata: { tourId: t.id, messaging: true, link: { href: chatLink(threadId), label: "Open the chat with the landlord" } } });
    }
    await notifyTourProposed({ tourId: t.id }).catch((err) => console.error("[tours] message alert failed:", err?.message ?? err));
    return { tour: shape(updated, "landlord"), threadId };
  }
  if (action === "cancel") {
    const { data: updated, error } = await supabase.from("tour_requests").update({ status: "cancelled", cancelled_by: landlordId, last_activity_at: now }).eq("id", t.id).select(TOUR_SELECT).single();
    if (error) throw fail("tour cancel", error);
    if (t.proxy_thread_id) await postProxyMessage({ threadId: t.proxy_thread_id, listingId: t.listing_id, type: "proxy_note", body: "The landlord cancelled your tour request. You can send new times from the calendar button, or look at similar places.", metadata: { tourId: t.id, cancelled: true } });
    await notifyTourCancelled({ tourId: t.id, by: "landlord" }).catch(() => {});
    return { tour: shape(updated, "landlord") };
  }
  return { error: "Unknown action", status: 400 };
}

export async function studentAct({ tourId, studentId, action, slots = [] }) {
  const t = await load(tourId);
  if (!t) return { error: "Tour request not found", status: 404 };
  if (t.student_id !== studentId) return { error: "Not your request", status: 403 };
  const now = new Date().toISOString();
  if (action === "update") {
    if (!["requested", "proposed", "messaging"].includes(t.status)) return { error: "This request can no longer be changed", status: 409 };
    const clean = validSlots(slots);
    if (!clean.length) return { error: "Pick at least one time that works for you.", status: 400 };
    const { data: updated, error } = await supabase.from("tour_requests").update({
      status: "requested", student_slots: clean, landlord_slots: [], last_activity_at: now,
    }).eq("id", t.id).select(TOUR_SELECT).single();
    if (error) throw fail("tour update", error);
    await saveAvailability(studentId, patternFromSlots(clean)).catch(() => {});
    await postAvailability({ t, listingId: t.listing_id, proxyThreadId: t.proxy_thread_id, studentId, clean, updated: true });
    await notifyTourRequested({ tourId: t.id }).catch((err) => console.error("[tours] update alert failed:", err?.message ?? err));
    return { tour: shape(updated, "student") };
  }
  if (action === "cancel") {
    if (!["requested", "proposed", "messaging", "confirmed"].includes(t.status)) return { error: "This request is already closed", status: 409 };
    const { data: updated, error } = await supabase.from("tour_requests").update({ status: "cancelled", cancelled_by: studentId, last_activity_at: now }).eq("id", t.id).select(TOUR_SELECT).single();
    if (error) throw fail("tour cancel", error);
    if (t.proxy_thread_id) await postProxyMessage({ threadId: t.proxy_thread_id, listingId: t.listing_id, type: "proxy_note", body: "Your tour request is cancelled. Send new times from the calendar button whenever you're ready.", metadata: { tourId: t.id, cancelled: true } });
    await notifyTourCancelled({ tourId: t.id, by: "student" }).catch(() => {});
    return { tour: shape(updated, "student") };
  }
  return { error: "Unknown action", status: 400 };
}

export async function listStudentTours(studentId) {
  const { data, error } = await supabase.from("tour_requests").select(TOUR_SELECT).eq("student_id", studentId).order("created_at", { ascending: false }).limit(50);
  if (error) throw fail("tours", error);
  return (data ?? []).map((t) => shape(t, "student"));
}

export async function listLandlordTours(landlordId) {
  const { data, error } = await supabase.from("tour_requests").select(TOUR_SELECT).eq("landlord_id", landlordId).order("created_at", { ascending: false }).limit(100);
  if (error) throw fail("tours", error);
  const ids = (data ?? []).map((t) => t.student_id);
  const { data: students } = ids.length ? await supabase.from("users").select("id, name").in("id", ids) : { data: [] };
  const names = new Map((students ?? []).map((s) => [s.id, s.name]));
  // The landlord sees the student's name from the request on (PRD: name and
  // slots at request, contact details on confirmation).
  return (data ?? []).map((t) => ({ ...shape(t, "landlord"), studentName: names.get(t.student_id) ?? "A student" }));
}

/* Open request on this listing for this student, for the panel. */
export async function openTourFor({ studentId, listingId }) {
  const { data } = await supabase.from("tour_requests").select(TOUR_SELECT).eq("student_id", studentId).eq("listing_id", listingId)
    .in("status", ["requested", "proposed", "messaging", "confirmed"]).order("created_at", { ascending: false }).limit(1);
  return data?.[0] ? shape(data[0], "student") : null;
}

/* ---- reminders (hourly cron) ------------------------------------------ */

export async function runTourReminders() {
  const out = { day1: 0, day3: 0, day5: 0, dayBefore: 0, expired: 0, errors: 0 };
  const DAY = 24 * 3600 * 1000;
  const before = (days) => new Date(Date.now() - days * DAY).toISOString();
  const now = new Date().toISOString();
  const { data: open } = await supabase.from("tour_requests").select("id, landlord_id, created_at, reminder_1_at, reminder_3_at, student_told_at, student_slots")
    .eq("status", "requested").lt("created_at", before(1)).limit(500);
  for (const t of open ?? []) {
    try {
      const slotsLeft = (t.student_slots ?? []).filter((s) => Date.parse(s) > Date.now());
      if (!slotsLeft.length) {
        await supabase.from("tour_requests").update({ status: "expired", last_activity_at: now }).eq("id", t.id);
        out.expired++;
        continue;
      }
      if (t.landlord_id && !t.reminder_1_at) { await notifyTourReminder({ tourId: t.id, day: 1 }); await supabase.from("tour_requests").update({ reminder_1_at: now }).eq("id", t.id); out.day1++; }
      else if (t.landlord_id && !t.reminder_3_at && t.created_at < before(3)) { await notifyTourReminder({ tourId: t.id, day: 3 }); await supabase.from("tour_requests").update({ reminder_3_at: now }).eq("id", t.id); out.day3++; }
      if (!t.student_told_at && t.created_at < before(5)) { await notifyTourNoAnswer({ tourId: t.id }); await supabase.from("tour_requests").update({ student_told_at: now }).eq("id", t.id); out.day5++; }
    } catch (err) { out.errors++; console.error("[tours] reminder failed on", t.id, err?.message ?? err); }
  }
  const { data: soon } = await supabase.from("tour_requests").select("id")
    .eq("status", "confirmed").is("day_before_reminded_at", null)
    .gt("confirmed_slot", now).lt("confirmed_slot", new Date(Date.now() + 26 * 3600 * 1000).toISOString()).limit(200);
  for (const t of soon ?? []) {
    try {
      await notifyTourReminder({ tourId: t.id, dayBefore: true });
      await supabase.from("tour_requests").update({ day_before_reminded_at: now }).eq("id", t.id);
      out.dayBefore++;
    } catch (err) { out.errors++; }
  }
  return out;
}

export { shortDate };
