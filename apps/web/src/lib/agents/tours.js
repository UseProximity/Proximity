/*
 * Tour scheduling (PRD v3, milestone 5; Wyatt, 2026-10-26).
 *
 * The student's account holds a weekly availability pattern (weekday and
 * one-hour blocks, 8am to 8pm, St. Louis time). A request turns the pattern
 * into real dates over the next 14 days, minus the ones the student unticks,
 * and goes to the owner of the lease. The landlord confirms one slot or
 * proposes any number of other slots, which go back to the student to pick
 * from, until one side confirms or cancels.
 *
 * On confirmation both sides get each other's name, email and phone, and an
 * in-app thread opens between them with the contact-detail and link
 * restrictions lifted (chat_threads.unrestricted). Proxy keeps answering in
 * the Proxy thread. Reminders: landlord at day 1 and 3, the student told on
 * day 5, and both reminded the day before a confirmed tour.
 */
import supabase from "@/lib/supabase";
import { postProxyMessage } from "./threads";
import { shortDate } from "./sections";
import {
  notifyTourRequested, notifyTourProposed, notifyTourConfirmed, notifyTourCancelled, notifyTourReminder, notifyTourNoAnswer,
} from "./tourNotify";

import { fmtSlot, normalizePattern, slotsFromPattern } from "./tourTime";

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
    // Each side sees only the other side's details, and only once confirmed.
    contact: t.status === "confirmed" ? (viewer === "student" ? t.landlord_contact : t.student_contact) : null,
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

export async function requestTour({ listingId, leaseId = null, studentId, slots, phone = null, email = null, proxyThreadId = null }) {
  const clean = validSlots(slots);
  if (!clean.length) return { error: "Pick at least one time that works for you.", status: 400 };
  const { data: student } = await supabase.from("users").select("id, email, phone").eq("id", studentId).maybeSingle();
  const phoneClean = String(phone ?? "").replace(/[^\d+() .-]/g, "").trim().slice(0, 30) || null;
  const emailClean = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email ?? "").trim()) ? String(email).trim().toLowerCase() : null;
  if (!phoneClean && !emailClean && !student?.email) return { error: "Add a phone number or email so the landlord can reach you.", status: 400 };
  const { data: owned } = await supabase.from("listing_landlords").select("listing_id").eq("listing_id", listingId).eq("user_id", studentId).limit(1);
  if (owned?.length) return { error: "You cannot book a tour of your own listing.", status: 400 };
  const landlordId = await resolveLandlord({ listingId, leaseId });
  if (!landlordId) return { error: "This listing has nobody to book a tour with yet.", status: 409 };

  const { data: tour, error } = await supabase.from("tour_requests").insert({
    listing_id: listingId, lease_id: leaseId, student_id: studentId, landlord_id: landlordId,
    status: "requested", student_slots: clean, student_phone: phoneClean, proxy_thread_id: proxyThreadId,
    // What the student typed; filled in with the account's details on confirmation.
    student_contact: emailClean || phoneClean ? { email: emailClean, phone: phoneClean } : null,
  }).select(TOUR_SELECT).single();
  if (error) {
    if (error.code === "23505") return { error: "You already have an open tour request for this place.", status: 409 };
    throw fail("tour create", error);
  }
  if (phoneClean && student && (!student.phone || student.phone === "N/A")) {
    await supabase.from("users").update({ phone: phoneClean }).eq("id", studentId);
  }
  if (proxyThreadId) {
    await postProxyMessage({ threadId: proxyThreadId, listingId, type: "proxy_note", body: `Tour requested. I've sent the landlord your available times (${clean.length} option${clean.length === 1 ? "" : "s"} over the next two weeks). I'll let you know as soon as they confirm one.`, metadata: { tourId: tour.id } });
  }
  notifyTourRequested({ tourId: tour.id }).catch((err) => console.error("[tours] request alert failed:", err?.message ?? err));
  return { tour: shape(tour, "student") };
}

async function load(tourId) {
  const { data, error } = await supabase.from("tour_requests").select(TOUR_SELECT).eq("id", tourId).maybeSingle();
  if (error) throw fail("tour", error);
  return data ?? null;
}

async function contactOf(userId) {
  const { data: u } = await supabase.from("users").select("name, email, phone").eq("id", userId).maybeSingle();
  if (!u) return null;
  return { name: u.name ?? null, email: u.email ?? null, phone: u.phone && u.phone !== "N/A" ? u.phone : null };
}

async function confirm(t, slot, byUserId) {
  const now = new Date().toISOString();
  const [studentContact, landlordContact] = await Promise.all([contactOf(t.student_id), contactOf(t.landlord_id)]);
  if (t.student_phone) studentContact.phone = t.student_phone;
  if (t.student_contact?.email) studentContact.email = t.student_contact.email;
  const when = fmtSlot(slot);
  const label = t.listings?.title || t.listings?.address || "the listing";

  // The in-app thread between the two, names and all, with contact details allowed.
  let threadId = t.thread_id ?? null;
  if (!threadId) {
    const { data: started, error } = await supabase.rpc("rpc_start_or_get_listing_chat", {
      p_user_id: t.student_id, p_listing_id: t.listing_id,
      p_body: `Tour confirmed for ${when} at ${label}. Reach me at ${[studentContact?.phone, studentContact?.email].filter(Boolean).join(" or ")}.`,
      p_lease_id: t.lease_id,
    });
    if (error) console.error("[tours] could not open the thread:", error.message);
    threadId = started?.threadId ?? null;
    if (threadId) {
      await supabase.from("chat_threads").update({ unrestricted: true }).eq("id", threadId);
      await supabase.from("chat_participants").upsert({ thread_id: threadId, user_id: t.landlord_id }, { onConflict: "thread_id,user_id", ignoreDuplicates: true });
    }
  }
  const { data: updated, error } = await supabase.from("tour_requests").update({
    status: "confirmed", confirmed_slot: slot, confirmed_by: byUserId, confirmed_at: now, student_contact: studentContact, landlord_contact: landlordContact,
    thread_id: threadId, last_activity_at: now,
  }).eq("id", t.id).select(TOUR_SELECT).single();
  if (error) throw fail("tour confirm", error);
  if (t.proxy_thread_id) {
    const reach = [landlordContact?.name, landlordContact?.phone, landlordContact?.email].filter(Boolean).join(", ");
    await postProxyMessage({ threadId: t.proxy_thread_id, listingId: t.listing_id, type: "proxy_note",
      body: `Your tour is confirmed for ${when}. The landlord has your contact details, and you have theirs: ${reach || "see your tours"}. You can also message them directly on Proximity now. I'm still here for any questions about the place.`,
      metadata: { tourId: t.id, confirmed: true } });
  }
  notifyTourConfirmed({ tourId: t.id }).catch((err) => console.error("[tours] confirm alert failed:", err?.message ?? err));
  return updated;
}

export async function landlordAct({ tourId, landlordId, action, slot = null, slots = [] }) {
  const t = await load(tourId);
  if (!t) return { error: "Tour request not found", status: 404 };
  if (t.landlord_id !== landlordId) return { error: "This request went to another landlord", status: 403 };
  if (!["requested", "proposed"].includes(t.status)) return { error: "This request is no longer open", status: 409 };
  const now = new Date().toISOString();
  if (action === "confirm") {
    const iso = validSlots([slot])[0];
    if (!iso || !(t.student_slots ?? []).includes(iso)) return { error: "Pick one of the student's times, or propose others.", status: 400 };
    const updated = await confirm(t, iso, landlordId);
    return { tour: shape(updated, "landlord") };
  }
  if (action === "propose") {
    const clean = validSlots(slots);
    if (!clean.length) return { error: "Pick at least one time to propose.", status: 400 };
    const { data: updated, error } = await supabase.from("tour_requests").update({ status: "proposed", landlord_slots: clean, last_activity_at: now }).eq("id", t.id).select(TOUR_SELECT).single();
    if (error) throw fail("tour propose", error);
    if (t.proxy_thread_id) {
      await postProxyMessage({ threadId: t.proxy_thread_id, listingId: t.listing_id, type: "proxy_note",
        body: `The landlord can't make the times you offered and proposed ${clean.length} other${clean.length === 1 ? "" : "s"}: ${clean.slice(0, 4).map((s) => fmtSlot(s)).join("; ")}${clean.length > 4 ? "; and more" : ""}. Pick one in your tour request below.`,
        metadata: { tourId: t.id, proposed: true } });
    }
    notifyTourProposed({ tourId: t.id }).catch((err) => console.error("[tours] proposal alert failed:", err?.message ?? err));
    return { tour: shape(updated, "landlord") };
  }
  if (action === "cancel") {
    const { data: updated, error } = await supabase.from("tour_requests").update({ status: "cancelled", cancelled_by: landlordId, last_activity_at: now }).eq("id", t.id).select(TOUR_SELECT).single();
    if (error) throw fail("tour cancel", error);
    if (t.proxy_thread_id) await postProxyMessage({ threadId: t.proxy_thread_id, listingId: t.listing_id, type: "proxy_note", body: "The landlord cancelled your tour request. You can request again with other times, or look at similar places.", metadata: { tourId: t.id, cancelled: true } });
    notifyTourCancelled({ tourId: t.id, by: "landlord" }).catch(() => {});
    return { tour: shape(updated, "landlord") };
  }
  return { error: "Unknown action", status: 400 };
}

export async function studentAct({ tourId, studentId, action, slot = null }) {
  const t = await load(tourId);
  if (!t) return { error: "Tour request not found", status: 404 };
  if (t.student_id !== studentId) return { error: "Not your request", status: 403 };
  const now = new Date().toISOString();
  if (action === "pick") {
    if (t.status !== "proposed") return { error: "There is nothing to pick from yet", status: 409 };
    const iso = validSlots([slot])[0];
    if (!iso || !(t.landlord_slots ?? []).includes(iso)) return { error: "Pick one of the proposed times.", status: 400 };
    const updated = await confirm(t, iso, studentId);
    return { tour: shape(updated, "student") };
  }
  if (action === "cancel") {
    if (!["requested", "proposed", "confirmed"].includes(t.status)) return { error: "This request is already closed", status: 409 };
    const { data: updated, error } = await supabase.from("tour_requests").update({ status: "cancelled", cancelled_by: studentId, last_activity_at: now }).eq("id", t.id).select(TOUR_SELECT).single();
    if (error) throw fail("tour cancel", error);
    notifyTourCancelled({ tourId: t.id, by: "student" }).catch(() => {});
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
    .in("status", ["requested", "proposed", "confirmed"]).order("created_at", { ascending: false }).limit(1);
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
