/*
 * The tour emails a landlord gets, in the inquiry layout of lib/inquiryEmail.js
 * (Wyatt, 2026-11-18).
 *
 * A request reads like the student wrote it: which unit, the times they can
 * make, "Could you let me know a time that works?", signed and sent From the
 * student's first name (Wyatt, 2026-11-20), or "A student" when they have no
 * name. A reminder puts "Reminder, a student is still waiting on your reply
 * about touring." on top of the same request. A student's cancellation is also
 * in their words, with the time when one was booked. Confirmed, day-before and
 * the landlord's own cancellation are announcements, so they open with the
 * fact. Never the student's contact details.
 *
 * Pure string work, so each one can be tested and previewed without sending.
 */
import { buildInquiryEmail, landlordReplyNotice } from "../inquiryEmail.js";

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
 * The request, and its reminder (`reminderDay` set). `firstName` is the
 * student's first name, or null. `slots` are availability lines ("Thu, Nov 20,
 * 2 to 5 PM"). `details` are the unit and student lines.
 */
export function buildTourRequestEmail({ firstName, listingLabel, unit, slots = [], details = [], dashboardUrl, completedAccount = true, canReply = false, reminderDay = null }) {
  const who = firstName || "A student";
  const times = slots.length
    ? `I'm free:\n${slots.map((s) => `• ${s}`).join("\n")}\nCould you let me know a time that works?`
    : "Could you let me know a time that works?";
  const { html, text } = buildInquiryEmail({
    lead: reminderDay ? "Reminder, a student is still waiting on your reply about touring." : null,
    messages: [{ body: `Hi, I'd like to tour ${where(unit, listingLabel)}. ${times}` }],
    signature: who,
    details: [
      "Tour request sent through Proximity (useproximity.org)",
      ...details,
      reminderDay ? "After five days Proxy will tell them there was no answer." : null,
      canReply
        ? `Pick a day and a start time inside their window in your dashboard, or reply to this email to message ${firstName || "the student"} directly.`
        : "Pick a day and a start time inside their window in your dashboard.",
    ],
    button: { label: completedAccount ? "Confirm a time" : "Create an account to confirm", url: dashboardUrl },
    reason: REASON,
    replyNotice: canReply ? landlordReplyNotice({ tour: true }) : null,
  });
  return {
    subject: `Tour request for ${listingLabel}`,
    fromName: who,
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
    replyNotice: canReply ? landlordReplyNotice({ tour: true }) : null,
  });
  return {
    subject: dayBefore ? `Reminder: tour of ${listingLabel} ${when}` : `Tour confirmed: ${who}, ${when}`,
    html,
    text,
  };
}

/**
 * The student cancelled. In their words, signed with their first name, with
 * the booked time (`when`) when the tour had been confirmed.
 */
export function buildTourCancelledEmail({ firstName, listingLabel, unit, when = null, dashboardUrl }) {
  const who = firstName || "A student";
  const { html, text } = buildInquiryEmail({
    messages: [{ body: when
      ? `Hi, I need to cancel my tour of ${where(unit, listingLabel)} on ${when}.`
      : `Hi, I need to cancel my tour request for ${where(unit, listingLabel)}.` }],
    signature: who,
    details: ["Tour request sent through Proximity (useproximity.org)", "Nothing else is needed from you."],
    button: { label: "Open your dashboard", url: dashboardUrl },
    reason: REASON,
  });
  return { subject: `Tour cancelled: ${listingLabel}`, fromName: who, html, text };
}

/** The landlord's confirmation that they cancelled (Wyatt, 2026-11-20). */
export function buildTourCancelledByLandlordEmail({ firstName, listingLabel, unit, when = null, dashboardUrl }) {
  const whose = firstName ? `${firstName}'s` : "a student's";
  const { html, text } = buildInquiryEmail({
    messages: [{ body: when
      ? `You cancelled ${whose} tour of ${where(unit, listingLabel)} on ${when}. We let ${firstName || "them"} know.`
      : `You cancelled ${whose} tour request for ${where(unit, listingLabel)}. We let ${firstName || "them"} know.` }],
    details: ["Tour request sent through Proximity (useproximity.org)", "They can send new times if they still want to tour."],
    button: { label: "Open your dashboard", url: dashboardUrl },
    reason: REASON,
  });
  return { subject: `You cancelled a tour: ${listingLabel}`, html, text };
}
