/*
 * The layout of every email a landlord gets about a student: a chat message, a
 * question Proxy relays, a tour request, and the reminders and tour updates
 * that follow (Wyatt, 2026-11-18).
 *
 * It leads with what the student wrote, in plain paragraphs, signed with their
 * name, exactly like an inquiry a person would send. Everything about Proximity
 * sits below a "-- " signature line: the kind of inquiry, the unit, the
 * student's school and class year, how to reply, the opt-out and our postal
 * address. Leasing assistants such as EliseAI answer an email that reads like
 * a prospect wrote it and ignored our old notification layout, and people read
 * the message first anyway. One layout for everyone, no special case for
 * leasing inboxes.
 *
 * A reminder adds one short line on top ("Reminder, a student is still waiting
 * on your reply.") and then repeats the original unchanged.
 *
 * The student's email address and phone number are never part of it: replies
 * come back through the private reply address and stay on Proximity.
 *
 * There is no "Reply above this line" marker (Wyatt, 2026-11-20: it sat under
 * the message, so it read backwards). Inbound parsing
 * (lib/chat/emailReplyText.js) cuts a reply at the quote header ("On ...
 * wrote:", Outlook's From/Sent block), the "-- " line, or the first details
 * line ("Message sent through Proximity" and the like).
 *
 * Pure string work, so the layout can be tested and previewed without sending.
 */
import { escapeHtml } from "./escapeHtml.js";
import { POSTAL_ADDRESS } from "./emailFooter.js";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MUTED = "#9ca3af";

// Line breaks as <br>, since Outlook ignores white-space:pre-wrap and would run
// the paragraphs of a message together.
const htmlLines = (text) => escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>");

const clean = (v) => String(v ?? "").trim();

/**
 * "Hi Yuki," was written to the account owner, which is not who reads a
 * leasing office inbox the alert is routed to. Drop the name, keep the greeting.
 * Only the opening greeting is touched, and only when it names `firstName`.
 */
export function stripOwnerGreeting(body, firstName) {
  const name = clean(firstName);
  const text = String(body ?? "");
  if (!name) return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Not \b: "José" ends in a character JavaScript does not count as a word character.
  return text.replace(new RegExp(`^(\\s*(?:hi|hey|hello|dear))\\s+${escaped}(?=$|[\\s,.!:;-])`, "i"), "$1");
}

/**
 * "2 bed, Apt 304, 980 sq ft, $1,850/month", or null when nothing is known.
 * `lease` is a unit_leases row with its listing_units row as `unit`.
 */
export function unitLabel(lease) {
  if (!lease) return null;
  const unit = lease.unit ?? lease.listing_units ?? null;
  const beds = unit?.bedrooms === 0 ? "Studio" : unit?.bedrooms ? `${unit.bedrooms} bed` : null;
  const name = clean(unit?.name) || (clean(unit?.unit_number) ? `Unit ${clean(unit.unit_number)}` : null)
    || String(lease.description ?? "").match(/\bApt\.?\s+[\w-]+/i)?.[0] || null;
  const rent = Number(lease.rent);
  const parts = [
    beds,
    name && name !== beds ? name : null,
    unit?.area ? `${unit.area} sq ft` : null,
    rent > 0 ? `$${rent.toLocaleString("en-US")}/month${lease.rent_is_per_person ? " per person" : ""}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** "WashU student, class of 2028", "WashU student", or "Student". */
export function studentLine({ school, graduationYear } = {}) {
  const who = clean(school) ? `${clean(school)} student` : "Student";
  return graduationYear ? `${who}, class of ${graduationYear}` : who;
}

/**
 * The footer line on landlord emails that can be answered by replying (Wyatt,
 * 2026-11-23): what is taken out of that reply before the student sees it.
 * `tour`: the reply goes to the tour's chat, where contact details are allowed.
 */
export function landlordReplyNotice({ tour = false } = {}) {
  const base = "Replies to this email go to the student on Proximity.";
  return tour
    ? `${base} Application links are removed before they see it, so add yours in your dashboard instead.`
    : `${base} Application links are removed before they see it, and so are contact details (phone numbers, email addresses, outside links and social handles) until a tour is booked. Add your application link in your dashboard instead.`;
}

/**
 * Build one email.
 *
 *   lead        optional line above the message (a reminder)
 *   messages    [{ body, label? }]: what the student wrote, in order; label is a
 *               small time shown above it when there are several
 *   quoted      optional { label, body }: an earlier message quoted under this one
 *   signature   the name under the message ("Jordan Lee", "A student")
 *   action      optional { label, url } button right under the message
 *   details     lines about the inquiry ("Message sent through Proximity", ...)
 *   howToReply  one line on how to answer, with an optional { label, url } link
 *   button      optional { label, url } in the details block
 *   reason      why this landed in their inbox
 *   replyNotice optional line on what is removed from an emailed reply
 *               (landlordReplyNotice)
 *
 * Returns { html, text }.
 */
export function buildInquiryEmail({
  lead = null,
  messages = [],
  quoted = null,
  signature = null,
  action = null,
  details = [],
  howToReply = null,
  button = null,
  reason,
  replyNotice = null,
}) {
  const list = messages.filter((m) => clean(m?.body));
  const lines = details.map(clean).filter(Boolean);
  const reply = howToReply?.text ? howToReply : null;

  const small = (inner, extra = "") => `<p style="margin:0 0 4px${extra}">${inner}</p>`;
  const html = `
    <div style="font-family:${FONT};max-width:560px;margin:0 auto;padding:16px 20px;color:#111827;font-size:15px;line-height:1.6">
      ${lead ? `<p style="margin:0 0 16px">${htmlLines(lead)}</p>` : ""}
      ${list
        .map((m) =>
          m.label
            ? `<p style="margin:0 0 2px;color:${MUTED};font-size:12px">${escapeHtml(m.label)}</p><p style="margin:0 0 16px">${htmlLines(m.body)}</p>`
            : `<p style="margin:0 0 16px">${htmlLines(m.body)}</p>`
        )
        .join("")}
      ${quoted?.body ? `<p style="margin:0 0 2px;color:#6b7280;font-size:13px">${escapeHtml(quoted.label ?? "")}</p><blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #e5e7eb;color:#374151">${htmlLines(quoted.body)}</blockquote>` : ""}
      ${signature ? `<p style="margin:0 0 16px">${escapeHtml(signature)}</p>` : ""}
      ${action ? `<a href="${action.url}" style="display:inline-block;margin:0 0 16px;padding:10px 18px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(action.label)}</a>` : ""}
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;line-height:1.5">
        ${lines.map((l) => small(escapeHtml(l))).join("")}
        ${reply ? small(`${escapeHtml(reply.text)}${reply.link ? ` <a href="${reply.link.url}" style="color:#6b7280">${escapeHtml(reply.link.label)}</a>` : ""}`) : ""}
        ${button ? `<a href="${button.url}" style="display:inline-block;margin:8px 0 4px;padding:9px 16px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px">${escapeHtml(button.label)}</a>` : ""}
        <div style="margin-top:10px;color:${MUTED};font-size:12px">
          ${replyNotice ? small(escapeHtml(replyNotice)) : ""}
          ${reason ? small(escapeHtml(reason)) : ""}
          <p style="margin:0">${POSTAL_ADDRESS}</p>
        </div>
      </div>
    </div>
  `;

  const text = [
    lead ? `${lead}\n` : null,
    ...list.map((m) => `${m.label ? `${m.label}\n` : ""}${clean(m.body)}\n`),
    quoted?.body ? `${quoted.label ?? ""}\n${clean(quoted.body).split("\n").map((l) => `> ${l}`).join("\n")}\n` : null,
    signature ? `${signature}\n` : null,
    action ? `${action.label}: ${action.url}\n` : null,
    "-- ",
    ...lines,
    reply ? `${reply.text}${reply.link ? ` ${reply.link.url}` : ""}` : null,
    button ? `${button.label}: ${button.url}` : null,
    "",
    replyNotice || null,
    reason || null,
    POSTAL_ADDRESS,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { html, text };
}
