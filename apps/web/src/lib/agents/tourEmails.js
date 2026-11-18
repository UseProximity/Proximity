/*
 * The tour emails a landlord gets, in the inquiry layout of lib/inquiryEmail.js
 * (Wyatt, 2026-11-18).
 *
 * A request reads like the student wrote it: which unit, the times they can
 * make, "Could you let me know a time that works?", signed with their name, or
 * "A student" until the landlord may see it (tourNotify.nameShown). A reminder
 * puts "Reminder, a student is still waiting on your reply about touring." on
 * top of the same request. Confirmed, day-before and cancelled are
 * announcements, so they open with the fact. Never the student's contact details.
 *
 * Pure string work, so each one can be tested and previewed without sending.
 */
import { buildInquiryEmail } from "../inquiryEmail.js";

const REASON = "You are receiving this because of a tour request on Proximity.";

/** "the 2 bed", "Unit 3B", or "" when the unit is unknown. */
function unitPhrase(unit) {
  if (!unit) return "";
  const name = String(unit.name ?? "").trim();
  if (name) return name;
  if (unit.bedrooms === 0) return "the studio";
  return unit.bedrooms ? `the ${unit.bedrooms} bed` : "";
}

const where = (unit, listingLabel) => {
  const u = unitPhrase(unit);
  return u ? `${u} at ${listingLabel}` : listingLabel;
};

/**
 * The request, and its reminder (`reminderDay` set). `slots` are availability
 * lines ("Thu, Nov 20, 2 to 5 PM"). `details` are the unit and student lines.
 */
export function buildTourRequestEmail({ studentLabel, listingLabel, unit, slots = [], details = [], dashboardUrl, completedAccount = true, canReply = false, reminderDay = null }) {
  const who = studentLabel || "A student";
  const times = slots.length
    ? `I'm free:\n${slots.map((s) => `• ${s}`).join("\n")}\nCould you let me know a time that works?`
    : "Could you let me know a time that works?";
  const { html, text } = buildInquiryEmail({
    lead: reminderDay ? "Reminder, a student is still waiting on your reply about touring." : null,
    messages: [{ body: `Hi, I'd like to tour ${where(unit, listingLabel)}. ${times}` }],
    signature: who,
    marker: canReply ? (studentLabel || "the student") : null,
    details: [
      "Tour request sent through Proximity (useproximity.org)",
      ...details,
      reminderDay ? "After five days Proxy will tell them there was no answer." : null,
      canReply
        ? "Pick a day and a start time inside their window in your dashboard, or reply to this email to message the student directly."
        : "Pick a day and a start time inside their window in your dashboard.",
    ],
    button: { label: completedAccount ? "Confirm a time" : "Create an account to confirm", url: dashboardUrl },
    reason: REASON,
  });
  return {
    subject: `Tour request for ${listingLabel}`,
    fromName: studentLabel || "A student",
    html,
    text,
  };
}

/** Confirmed, or the day-before reminder (`dayBefore`). */
export function buildTourConfirmedEmail({ studentName, listingLabel, unit, when, address, chatUrl, canReply = false, dayBefore = false }) {
  const who = studentName || "A student";
  const fact = dayBefore
    ? `Reminder: ${who} is touring ${where(unit, listingLabel)} ${when}.`
    : `${who} is touring ${where(unit, listingLabel)} on ${when}.`;
  const { html, text } = buildInquiryEmail({
    messages: [{ body: address ? `${fact}\n${address}` : fact }],
    details: [
      dayBefore ? "Tour booked through Proximity (useproximity.org)" : "Booked through Proximity (useproximity.org). Calendar invite attached.",
      canReply ? `Reply to this email to message ${studentName ? studentName.split(/\s+/)[0] : "the student"}.` : null,
    ],
    button: chatUrl ? { label: "Open the chat", url: chatUrl } : null,
    reason: REASON,
  });
  return {
    subject: dayBefore ? `Reminder: tour of ${listingLabel} ${when}` : `Tour confirmed: ${who}, ${when}`,
    html,
    text,
  };
}

/** The student cancelled their request. */
export function buildTourCancelledEmail({ studentLabel, listingLabel, dashboardUrl }) {
  const { html, text } = buildInquiryEmail({
    messages: [{ body: `${studentLabel || "A student"} cancelled their tour request for ${listingLabel}.` }],
    details: ["Tour request sent through Proximity (useproximity.org)", "Nothing else is needed from you."],
    button: { label: "Open your dashboard", url: dashboardUrl },
    reason: REASON,
  });
  return { subject: `Tour request cancelled: ${listingLabel}`, html, text };
}
