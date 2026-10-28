/*
 * Emails for tour scheduling. Each one goes through lib/email.js, so off
 * production it is redirected or suppressed like every other email.
 *
 * The landlord sees the student's name and availability (as plain ranges)
 * from the request on. Contact details are never sent (Wyatt, 2026-10-27):
 * once a tour is confirmed or the landlord reaches out, the two talk in the
 * direct chat, and replying to these emails posts into that chat.
 */
import supabase from "@/lib/supabase";
import { getBaseUrl, sendTourEmail } from "@/lib/email";
import { postProxyMessage } from "./threads";
import { availabilityText, fmtTourTime } from "./tourTime";
import { ensureReplyAddress } from "@/lib/chat/replyAddress";

const TZ = "America/Chicago";
const fmt = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

// The student's link: their Proxy conversation on the listing, which carries the tour.
function studentUrl(r) {
  return r.t.proxy_thread_id ? `${getBaseUrl()}/?messages=1&thread=${r.t.proxy_thread_id}` : `${getBaseUrl()}/listings/${r.t.listing_id}?listingTab=contact`;
}

const chatUrl = (threadId) => `${getBaseUrl()}/?messages=1&thread=${threadId}`;
const rangeLines = (slots) => availabilityText((slots ?? []).filter((s) => Date.parse(s) > Date.now())).split("\n").filter(Boolean);

async function loadTour(tourId) {
  const { data: t } = await supabase.from("tour_requests")
    .select("*, listings!listing_id(title, address), unit_leases!lease_id(rent, listing_units!unit_id(name, bedrooms, bathrooms))")
    .eq("id", tourId).maybeSingle();
  if (!t) return null;
  const [student, landlord] = await Promise.all([
    supabase.from("users").select("id, name, email, phone, email_notifications, password_hash, google_account, deleted_at").eq("id", t.student_id).maybeSingle(),
    t.landlord_id ? supabase.from("users").select("id, name, email, phone, email_notifications, password_hash, google_account, deleted_at").eq("id", t.landlord_id).maybeSingle() : { data: null },
  ]);
  const unit = t.unit_leases?.listing_units;
  return {
    t, student: student.data, landlord: landlord.data,
    listingLabel: t.listings?.title || t.listings?.address || "the listing",
    address: t.listings?.address ?? "",
    leaseLabel: unit ? `${unit.name || `${unit.bedrooms ?? "?"} bed, ${unit.bathrooms ?? "?"} bath`}${t.unit_leases?.rent ? ` at $${Number(t.unit_leases.rent).toLocaleString("en-US")}/mo` : ""}` : null,
  };
}

const canEmail = (u) => u && u.email && !u.deleted_at && u.email_notifications !== false;

function ics({ uid, start, summary, location, description }) {
  const s = new Date(start);
  const e = new Date(s.getTime() + 3600 * 1000);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const esc = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Proximity//Tours//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${uid}@useproximity.org`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(s)}`, `DTEND:${stamp(e)}`,
    `SUMMARY:${esc(summary)}`, `LOCATION:${esc(location)}`, `DESCRIPTION:${esc(description)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

export async function notifyTourRequested({ tourId }) {
  const r = await loadTour(tourId);
  if (!r || !canEmail(r.landlord)) return "no_recipient";
  await sendTourEmail({
    kind: "tour_request", to: r.landlord.email, name: r.landlord.name,
    subject: `${r.student?.name || "A student"} wants to tour ${r.listingLabel}`,
    intro: `${r.student?.name || "A student"} asked to tour ${r.listingLabel}${r.leaseLabel ? ` (${r.leaseLabel})` : ""} and can make any of these times:`,
    lines: rangeLines(r.t.student_slots),
    note: "Pick a day and a start time inside their window in your dashboard, or message the student if none of it works.",
    ctaLabel: r.landlord.password_hash || r.landlord.google_account ? "Confirm a time" : "Create an account to confirm",
    ctaUrl: `${getBaseUrl()}/dashboard/landlord?tab=tours`,
    userId: r.landlord.id,
  });
  return "sent";
}

/* The landlord couldn't make the times and wrote to the student directly. */
export async function notifyTourProposed({ tourId }) {
  const r = await loadTour(tourId);
  if (!r || !canEmail(r.student) || !r.t.thread_id) return "no_recipient";
  const { data: first } = await supabase.from("chat_messages").select("body").eq("thread_id", r.t.thread_id).eq("sender_id", r.t.landlord_id)
    .is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const replyTo = await ensureReplyAddress({ threadId: r.t.thread_id, userId: r.student.id }).catch(() => null);
  await sendTourEmail({
    kind: "tour_proposal", to: r.student.email, name: r.student.name,
    subject: `The landlord at ${r.listingLabel} wrote to you about your tour`,
    intro: `The landlord couldn't make the times you offered for ${r.listingLabel}, so they wrote to you directly:`,
    lines: first?.body ? [first.body] : [],
    note: replyTo ? "Reply to this email to answer them, or open the chat." : "Open the chat to answer them.",
    ctaLabel: "Open the chat", ctaUrl: chatUrl(r.t.thread_id), userId: r.student.id, replyTo, threadId: r.t.thread_id,
  });
  return "sent";
}

export async function notifyTourConfirmed({ tourId }) {
  const r = await loadTour(tourId);
  if (!r) return "no_recipient";
  const when = fmtTourTime(r.t.confirmed_slot);
  const file = {
    filename: "proximity-tour.ics", contentType: "text/calendar",
    content: ics({ uid: r.t.id, start: r.t.confirmed_slot, summary: `Tour: ${r.listingLabel}`, location: r.address, description: `Tour of ${r.listingLabel} booked on Proximity.` }),
  };
  const sent = [];
  for (const [u, isStudent] of [[r.student, true], [r.landlord, false]]) {
    if (!canEmail(u)) continue;
    const replyTo = r.t.thread_id ? await ensureReplyAddress({ threadId: r.t.thread_id, userId: u.id }).catch(() => null) : null;
    await sendTourEmail({
      kind: "tour_confirmed", to: u.email, name: u.name,
      subject: isStudent ? `Tour confirmed: ${r.listingLabel}, ${when}` : `Tour confirmed: ${r.student?.name || "a student"}, ${when}`,
      intro: isStudent
        ? `You're booked to tour ${r.listingLabel}${r.leaseLabel ? ` (${r.leaseLabel})` : ""} on ${when}.`
        : `${r.student?.name || "A student"} is touring ${r.listingLabel}${r.leaseLabel ? ` (${r.leaseLabel})` : ""} on ${when}.`,
      lines: [`Address: ${r.address}`],
      note: `You can message ${isStudent ? "the landlord" : "them"} in the chat${replyTo ? ", or just reply to this email" : ""}.`,
      ctaLabel: "Open the chat", ctaUrl: r.t.thread_id ? chatUrl(r.t.thread_id) : (isStudent ? studentUrl(r) : `${getBaseUrl()}/dashboard/landlord?tab=tours`),
      attachment: file, userId: u.id, replyTo, threadId: r.t.thread_id,
    });
    sent.push(isStudent ? "student" : "landlord");
  }
  return sent.join(",") || "no_recipient";
}

export async function notifyTourCancelled({ tourId, by }) {
  const r = await loadTour(tourId);
  if (!r) return "no_recipient";
  const target = by === "student" ? r.landlord : r.student;
  if (!canEmail(target)) return "no_recipient";
  await sendTourEmail({
    kind: "tour_cancelled", to: target.email, name: target.name,
    subject: `Tour request cancelled: ${r.listingLabel}`,
    intro: by === "student" ? `${r.student?.name || "The student"} cancelled their tour request for ${r.listingLabel}.` : `The landlord cancelled the tour request for ${r.listingLabel}.`,
    lines: [], note: by === "student" ? "" : "You can send new times from the calendar button in the chat.",
    ctaLabel: by === "student" ? "Open your dashboard" : "Back to the listing",
    ctaUrl: by === "student" ? `${getBaseUrl()}/dashboard/landlord?tab=tours` : `${getBaseUrl()}/listings/${r.t.listing_id}?listingTab=contact`,
    userId: target.id,
  });
  return "sent";
}

export async function notifyTourReminder({ tourId, day = null, dayBefore = false }) {
  const r = await loadTour(tourId);
  if (!r) return "no_recipient";
  if (dayBefore) {
    const when = fmtTourTime(r.t.confirmed_slot);
    for (const u of [r.student, r.landlord]) {
      if (!canEmail(u)) continue;
      const replyTo = r.t.thread_id ? await ensureReplyAddress({ threadId: r.t.thread_id, userId: u.id }).catch(() => null) : null;
      await sendTourEmail({
        kind: "tour_reminder", to: u.email, name: u.name, subject: `Reminder: tour of ${r.listingLabel} ${when}`,
        intro: `Your tour of ${r.listingLabel} is ${when}.`,
        lines: [`Address: ${r.address}`],
        note: replyTo ? "Reply to this email to message the other side." : "",
        ctaLabel: "Open the chat", ctaUrl: r.t.thread_id ? chatUrl(r.t.thread_id) : studentUrl(r), userId: u.id, replyTo, threadId: r.t.thread_id,
      });
    }
    return "sent";
  }
  if (!canEmail(r.landlord)) return "no_recipient";
  await sendTourEmail({
    kind: "tour_reminder", to: r.landlord.email, name: r.landlord.name,
    subject: `Reminder: ${r.student?.name || "a student"} is waiting to tour ${r.listingLabel}`,
    intro: `${r.student?.name || "A student"} asked ${day === 1 ? "yesterday" : `${day} days ago`} to tour ${r.listingLabel} and is still waiting. They're available:`,
    lines: rangeLines(r.t.student_slots),
    note: "After five days Proxy will tell them there was no answer.",
    ctaLabel: "Confirm a time", ctaUrl: `${getBaseUrl()}/dashboard/landlord?tab=tours`, userId: r.landlord.id,
  });
  return "sent";
}

export async function notifyTourNoAnswer({ tourId }) {
  const r = await loadTour(tourId);
  if (!r) return "no_recipient";
  if (r.t.proxy_thread_id) {
    await postProxyMessage({ threadId: r.t.proxy_thread_id, listingId: r.t.listing_id, type: "proxy_note",
      body: "The landlord hasn't responded to your tour request yet. I'll let you know if they do. If you're still interested, you can keep the request open, try other times, or browse similar places on Proximity.",
      metadata: { tourId: r.t.id, noAnswer: true } });
  }
  if (!canEmail(r.student)) return "posted";
  await sendTourEmail({
    kind: "tour_no_answer", to: r.student.email, name: r.student.name,
    subject: `No answer yet on your tour request for ${r.listingLabel}`,
    intro: `The landlord hasn't responded to your tour request for ${r.listingLabel} yet.`,
    lines: [], note: "If you're still interested, keep the request open, try other times, or browse similar places.",
    ctaLabel: "Browse similar places", ctaUrl: `${getBaseUrl()}/browse`, userId: r.student.id,
  });
  return "sent";
}
