/*
 * Emails for tour scheduling. Each one goes through lib/email.js, so off
 * production it is redirected or suppressed like every other email.
 *
 * The landlord sees the student's name from the request on; contact details
 * appear in the confirmation email only, for both sides, with a calendar
 * file attached.
 */
import supabase from "@/lib/supabase";
import { getBaseUrl, sendTourEmail } from "@/lib/email";
import { postProxyMessage } from "./threads";

const TZ = "America/Chicago";
const fmt = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

// The student's link: their Proxy conversation on the listing, which carries the tour.
function studentUrl(r) {
  return r.t.proxy_thread_id ? `${getBaseUrl()}/?messages=1&thread=${r.t.proxy_thread_id}` : `${getBaseUrl()}/listings/${r.t.listing_id}?listingTab=contact`;
}

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
    lines: (r.t.student_slots ?? []).slice(0, 12).map(fmt),
    note: "Confirm one of these times in your dashboard, or propose others. Their contact details are shared with you when a time is confirmed.",
    ctaLabel: r.landlord.password_hash || r.landlord.google_account ? "Confirm a time" : "Create an account to confirm",
    ctaUrl: `${getBaseUrl()}/dashboard/landlord?tab=tours`,
    userId: r.landlord.id,
  });
  return "sent";
}

export async function notifyTourProposed({ tourId }) {
  const r = await loadTour(tourId);
  if (!r || !canEmail(r.student)) return "no_recipient";
  await sendTourEmail({
    kind: "tour_proposal", to: r.student.email, name: r.student.name,
    subject: `The landlord proposed other times for your tour of ${r.listingLabel}`,
    intro: `The landlord can't make the times you offered for ${r.listingLabel}. They proposed:`,
    lines: (r.t.landlord_slots ?? []).slice(0, 12).map(fmt),
    note: "Pick one from the listing page or your dashboard, and you're booked.",
    ctaLabel: "Pick a time", ctaUrl: `${getBaseUrl()}/listings/${r.t.listing_id}?listingTab=contact`, userId: r.student.id,
  });
  return "sent";
}

export async function notifyTourConfirmed({ tourId }) {
  const r = await loadTour(tourId);
  if (!r) return "no_recipient";
  const when = fmt(r.t.confirmed_slot);
  const sc = r.t.student_contact ?? {};
  const lc = r.t.landlord_contact ?? {};
  const file = {
    filename: "proximity-tour.ics", contentType: "text/calendar",
    content: ics({ uid: r.t.id, start: r.t.confirmed_slot, summary: `Tour: ${r.listingLabel}`, location: r.address, description: `Tour of ${r.listingLabel} booked on Proximity.` }),
  };
  const sent = [];
  if (canEmail(r.student)) {
    await sendTourEmail({
      kind: "tour_confirmed", to: r.student.email, name: r.student.name,
      subject: `Tour confirmed: ${r.listingLabel}, ${when}`,
      intro: `You're booked to tour ${r.listingLabel}${r.leaseLabel ? ` (${r.leaseLabel})` : ""} on ${when}.`,
      lines: [`Landlord: ${[lc.name, lc.phone, lc.email].filter(Boolean).join(", ") || "see your dashboard"}`, `Address: ${r.address}`],
      note: "Reach the landlord by phone or email to coordinate. Proxy is still there for questions about the place.",
      ctaLabel: "Open the conversation", ctaUrl: studentUrl(r), attachment: file, userId: r.student.id,
    });
    sent.push("student");
  }
  if (canEmail(r.landlord)) {
    await sendTourEmail({
      kind: "tour_confirmed", to: r.landlord.email, name: r.landlord.name,
      subject: `Tour confirmed: ${r.student?.name || "a student"} on ${when}`,
      intro: `${r.student?.name || "A student"} is touring ${r.listingLabel}${r.leaseLabel ? ` (${r.leaseLabel})` : ""} on ${when}.`,
      lines: [`Reach them at: ${[sc.phone, sc.email].filter(Boolean).join(" or ") || "see your dashboard"}`],
      note: "Reach them by phone or email to coordinate.",
      ctaLabel: "Open your tours", ctaUrl: `${getBaseUrl()}/dashboard/landlord?tab=tours`, attachment: file, userId: r.landlord.id,
    });
    sent.push("landlord");
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
    lines: [], note: by === "student" ? "" : "You can request again with other times from the listing page.",
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
    const when = fmt(r.t.confirmed_slot);
    for (const [u, other] of [[r.student, r.t.landlord_contact], [r.landlord, r.t.student_contact]]) {
      if (!canEmail(u)) continue;
      await sendTourEmail({
        kind: "tour_reminder", to: u.email, name: u.name, subject: `Reminder: tour of ${r.listingLabel} ${when}`,
        intro: `Your tour of ${r.listingLabel} is ${when}.`,
        lines: [`${u.id === r.student?.id ? "Landlord" : "Student"}: ${[other?.name, other?.phone, other?.email].filter(Boolean).join(", ")}`, `Address: ${r.address}`],
        note: "", ctaLabel: u.id === r.student?.id ? "Open the conversation" : "Open your tours", ctaUrl: u.id === r.student?.id ? studentUrl(r) : `${getBaseUrl()}/dashboard/landlord?tab=tours`, userId: u.id,
      });
    }
    return "sent";
  }
  if (!canEmail(r.landlord)) return "no_recipient";
  await sendTourEmail({
    kind: "tour_reminder", to: r.landlord.email, name: r.landlord.name,
    subject: `Reminder: ${r.student?.name || "a student"} is waiting to tour ${r.listingLabel}`,
    intro: `${r.student?.name || "A student"} asked ${day === 1 ? "yesterday" : `${day} days ago`} to tour ${r.listingLabel} and is still waiting. Their times:`,
    lines: (r.t.student_slots ?? []).filter((s) => Date.parse(s) > Date.now()).slice(0, 12).map(fmt),
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
