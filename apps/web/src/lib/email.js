/*
 * Transactional email client using Nodemailer over SMTP. Currently sends two types of
 * email: password reset links (sendPasswordResetEmail) and email verification links
 * (sendVerificationEmail). Both are triggered server-side from their respective API
 * routes — reset-password and signup/resend-verification. getBaseUrl() derives the
 * correct protocol and host from the incoming request headers so links work in both local
 * dev (http://localhost:3000) and production (https://useproximity.org). SMTP credentials
 * are read from EMAIL_HOST, EMAIL_PORT, EMAIL_USER, and EMAIL_PASS environment variables.
 */
import nodemailer from "nodemailer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { outreachEnabled, sendMailSafe } from "./outreach";
import { buildVerifyUrl } from "./auth/verifyUrl";
import { stayOnProximityNote } from "./chat/moderation";
import { escapeHtml } from "./escapeHtml";
import { emailFooter, OPT_OUT_INBOX, POSTAL_ADDRESS } from "./emailFooter";
import { buildInquiryEmail, landlordReplyNotice, stripOwnerGreeting } from "./inquiryEmail";

export { emailFooter };
import { MREC_FORM_FILENAME, MREC_FORM_KIND, MREC_FORM_SUBJECT } from "./users/mrecForm";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  // STARTTLS or nothing: never let a stripped EHLO send AUTH in cleartext.
  requireTLS: true,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

/*
 * Amazon SES, for chat alerts and alert-address confirmations. It can send
 * from a reply+token address on our own reply domain, which Gmail SMTP cannot
 * (Gmail can only set it as the Reply-To), and it reports bounces and complaints back to
 * /api/ses/events. Null when the AWS_SES_* variables are missing, in which case
 * those emails go through Gmail like everything else.
 */
const sesTransporter =
  process.env.AWS_SES_ACCESS_KEY_ID && process.env.AWS_SES_SECRET_ACCESS_KEY
    ? nodemailer.createTransport({
        SES: {
          sesClient: new SESv2Client({
            region: process.env.AWS_SES_REGION || "us-east-1",
            credentials: {
              accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY,
            },
          }),
          SendEmailCommand,
        },
      })
    : null;

// Routes bounce and complaint events to the SNS topic behind /api/ses/events.
const SES_SEND_OPTIONS = {
  ConfigurationSetName: process.env.AWS_SES_CONFIGURATION_SET || "proximity-chat-alerts",
};

export function getBaseUrl() {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export async function sendPasswordResetEmail({ email, name, token, baseUrl, req }) {
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;
  await sendMailSafe(
    transporter,
    {
      logAs: { kind: "password_reset" },
      from: `"Proximity" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset your Proximity password",
      html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Reset your password${name ? `, ${escapeHtml(name)}` : ""}</h2>
        <p>Click the button below to set a new password. This link expires in 1 hour.</p>
        <a href="${resetUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Reset Password
        </a>
        <p style="color:#666;font-size:14px">Or copy this link:<br>${resetUrl}</p>
        <p style="color:#999;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
        ${emailFooter({
          reason: "You are receiving this because someone asked to reset the password on the Proximity account for this address.",
        })}
      </div>
    `,
    },
    req
  );
}

export async function sendLandlordNudgeEmail({ email, name }) {
  const firstName = name ? name.split(" ")[0] : "";
  await sendMailSafe(transporter, {
    logAs: { kind: "landlord_nudge" },
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: email,
    replyTo: "info@useproximity.org",
    subject: "Having trouble getting your listing up?",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        <h2 style="color:#111">Welcome to Proximity${firstName ? `, ${escapeHtml(firstName)}` : ""}!</h2>
        <p>I noticed you created a landlord account but haven't posted a listing yet.</p>
        <p>If something's getting in the way — photos, the address, lease details, anything —
           just reply to this email and we'll help you get your place live in a few minutes.</p>
        <a href="https://useproximity.org/dashboard/landlord"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Post your listing
        </a>
        <p style="color:#666;font-size:14px">WashU students are searching for off-campus housing right now —
           getting listed takes about five minutes.</p>
        <p style="color:#999;font-size:12px">— The Proximity team</p>
        ${emailFooter({
          reason: "You are receiving this because you created a landlord account on Proximity.",
          commercial: true,
        })}
      </div>
    `,
  });
}

/*
 * The MREC Broker Disclosure Form, attached, for a new landlord's records
 * (lib/users/mrecForm.js decides who gets it and when). Nothing to sign or send
 * back, which the subject says so nobody replies to ask.
 */
export async function sendMrecFormEmail({ email, name, userId, pdf, req }) {
  const firstName = name ? name.split(" ")[0] : "";
  await sendMailSafe(
    transporter,
    {
      logAs: { kind: MREC_FORM_KIND, userId },
      from: `"Proximity" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: MREC_FORM_SUBJECT,
      attachments: [{ filename: MREC_FORM_FILENAME, content: Buffer.from(pdf), contentType: "application/pdf" }],
      html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        <p>Hi${firstName ? ` ${escapeHtml(firstName)}` : ""},</p>
        <p>Attached is the Missouri Real Estate Commission&#39;s Broker Disclosure Form, for your records.</p>
        <p>There is nothing to sign, fill in or send back, and no need to reply.</p>
        <p style="color:#999;font-size:12px">The Proximity team</p>
        ${emailFooter({
          reason: "You are receiving this because you created a landlord account on Proximity.",
        })}
      </div>
    `,
    },
    req
  );
}

// Inquiry sent on a student's behalf by the matchmaking chatbot ("Proxy"). Goes to the
// listing's owner with the student CC'd and set as reply-to, so the landlord replies
// straight to the student. Routed through sendMailSafe, so on staging it's redirected to
// the chosen test inbox (and the cc is dropped) — never reaching a real owner.
// `sandbox` is true when a review sandbox account sent the inquiry: sendMailSafe then
// does not send it at all (it is only recorded as suppressed).
export async function sendOwnerInquiryEmail({ to, landlordName, student, listingAddress, message, req, sandbox = false }) {
  // The contact flow always supplies the student's note (the editable draft can't be
  // sent empty), so use it directly. The short guard only avoids a blank quote if a
  // future caller omits it — the real default lives in contactNote.js.
  const note = (message && message.trim()) || "I'm a WashU student interested in this listing and would love to learn more.";
  // Every one of these is typed by a user (the student, or the landlord for their own
  // name and address), so all of them are escaped before they reach the template.
  const e = {
    landlordName: escapeHtml(landlordName || "there"),
    listingAddress: escapeHtml(listingAddress),
    studentName: escapeHtml(student.name),
    studentEmail: escapeHtml(student.email),
    // Percent-encode so "?", "&" and "#" (all legal in an address's local part) can't
    // add mailto params like bcc, then put "@" back: some mail clients don't decode
    // "%40" and the reply would bounce.
    mailto: escapeHtml(encodeURIComponent(student.email || "").replace(/%40/g, "@")),
    note: escapeHtml(note),
  };
  return sendMailSafe(transporter, {
    logAs: { kind: "owner_inquiry" },
    sandbox,
    from: `"Proximity" <${process.env.EMAIL_USER || "info@useproximity.org"}>`,
    to,
    cc: student.email || undefined,
    replyTo: student.email || undefined,
    subject: `New Inquiry: ${listingAddress || "Your Listing"} (via Proximity)`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
        <p>Hi ${e.landlordName},</p>
        <p>You've received a new inquiry${listingAddress ? ` about your listing at <strong>${e.listingAddress}</strong>` : ""} through Proximity.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="margin: 6px 0;"><strong>From:</strong> ${e.studentName}</p>
        <p style="margin: 6px 0;"><strong>Email:</strong> <a href="mailto:${e.mailto}" style="color: #dc2626;">${e.studentEmail}</a></p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="white-space: pre-wrap; color: #374151; font-style: italic;">"${e.note}"</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p>Reply directly to this email to respond to ${e.studentName}. Quick responses help students make confident decisions, and responsive landlords tend to get the best tenants.</p>
        <p>Best,<br/>The Proximity Team<br/><a href="https://useproximity.org" style="color: #dc2626;">useproximity.org</a></p>
        ${emailFooter({
          reason: "You are receiving this because a student sent an inquiry about a property listed on Proximity as yours.",
        })}
      </div>
    `,
  }, req);
}

const CHAT_FROM_ADDRESS = "info@useproximity.org";
const CHAT_TIME_ZONE = "America/Chicago";

// Display names go into a header, so no quotes, angle brackets or line breaks.
function displayName(value, fallback) {
  const clean = String(value ?? "").replace(/["<>\r\n]/g, "").trim();
  return clean || fallback;
}

// "LOCAL on Delmar" when the listing has a name, else the street part of the
// address ("6811 Kingsbury"), matching the conversation header in the app.
export function chatListingLabel({ listingTitle, listingAddress, subject }) {
  const title = String(listingTitle ?? "").trim();
  if (title) return title;
  const street = String(listingAddress ?? "").split(",")[0].trim();
  return street || String(subject ?? "").trim() || "your conversation";
}

function chatMessageText(m) {
  const body = String(m?.body ?? "").trim();
  if (m?.messageType === "attachment") {
    const note = "(Attached a photo or document. Open the conversation on Proximity to see it.)";
    return body ? `${body}\n${note}` : note;
  }
  return body;
}

// Line breaks as <br>, since Outlook ignores white-space:pre-wrap and would run
// the paragraphs of a message together.
function chatMessageHtml(m) {
  return escapeHtml(chatMessageText(m)).replace(/\r\n|\r|\n/g, "<br>");
}

// A small time above each message, only when the email carries more than one,
// so a burst reads as separate messages rather than one long one: "8:21 PM",
// or "Oct 12, 8:21 PM" when the batch spans more than a day. Empty strings
// when there is nothing to label.
function chatTimeLabels(list) {
  if (list.length < 2) return list.map(() => "");
  const dates = list.map((m) => new Date(m?.createdAt ?? NaN));
  if (dates.some((d) => Number.isNaN(d.getTime()))) return list.map(() => "");
  const dayOf = new Intl.DateTimeFormat("en-US", { timeZone: CHAT_TIME_ZONE, dateStyle: "medium" });
  const sameDay = new Set(dates.map((d) => dayOf.format(d))).size === 1;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: CHAT_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
  });
  return dates.map((d) => fmt.format(d));
}

/*
 * Alert for new chat messages, one email per batch of unread messages.
 *
 * Subject and threading headers stay the same for every alert in a thread, so
 * mail apps stack them into one conversation: "Proximity Inquiry · LOCAL on
 * Delmar · Angela Clayton" (Wyatt, 2026-10-09). The From name is the other
 * person ("Angela Clayton via Proximity") on our own address, or just
 * "Proximity" for an account with no name.
 *
 * Sent through SES, that address is the private reply+token address itself,
 * not info@ (Wyatt, 2026-10-29). A forward keeps only the From line, so a
 * colleague answering a forwarded alert used to reach the shared inbox instead
 * of the conversation. CHAT_FROM_REPLY_ADDRESS=0 goes back to info@.
 *
 * With a replyTo (the private reply+token address) the email says it can be
 * answered directly. Without one it only points to the app, since a reply
 * would land in the shared inbox instead. The Gmail fallback keeps the
 * replyTo as its Reply-To header (Wyatt, 2026-11-04): it used to drop it, and
 * when SES refused every send for two days, landlords' replies to those
 * fallback emails went to info@ and never reached the conversation.
 *
 * The email reads like one the other person wrote, not a notification about
 * one (Wyatt, 2026-10-12): their words first, in plain paragraphs, then a short
 * signature with their name, company and the listing, then the small print.
 * No greeting from us, no "X sent you a message" narration, no button. The
 * "reply above this line" marker stays, in the faintest text, because inbound
 * parsing cuts the quoted alert there.
 *
 * `reminder` (Wyatt, 2026-10-16): the 3 day follow-up from the check-in cron. Same
 * email, same subject so it stacks under the original, with one line on top saying
 * the other person is still waiting.
 */
export function buildChatMessageEmail({
  senderName,
  senderCompany,
  listingTitle,
  listingAddress,
  subject: threadSubject,
  messages,
  earlierCount = 0,
  recipientIsInterestedUser,
  threadUrl,
  canReply,
  reminder = false,
  action = null,
  // Landlord alerts only: lines about the inquiry (unit, student's school and
  // class year) and the first name a routed alert's greeting is stripped of.
  details = [],
  ownerFirst = null,
}) {
  if (!recipientIsInterestedUser) {
    return buildLandlordChatEmail({
      senderName, listingTitle, listingAddress, subject: threadSubject, messages, earlierCount,
      threadUrl, canReply, reminder, action, details, ownerFirst,
    });
  }
  const named = displayName(senderName, "");
  const other = named || "Someone";
  const otherFirst = other.split(/\s+/)[0];
  const company = displayName(senderCompany, "");
  const listingLabel = chatListingLabel({ listingTitle, listingAddress, subject: threadSubject });
  const subject = ["Proximity Inquiry", listingLabel, named].filter(Boolean).join(" · ");
  const fromName = named ? `${otherFirst} via Proximity` : "Proximity";
  const list = Array.isArray(messages) && messages.length > 0 ? messages : [];
  const labels = chatTimeLabels(list);
  const street = String(listingAddress ?? "").split(",")[0].trim();
  const about = street && street !== listingLabel ? `${listingLabel}, ${street}` : listingLabel;

  const how = canReply
    ? `Reply to this email and ${escapeHtml(otherFirst)} will see it on Proximity, or <a href="${threadUrl}" style="color:#9ca3af">open the conversation</a>.`
    : `<a href="${threadUrl}" style="color:#9ca3af">Open the conversation on Proximity</a> to reply.`;
  const earlier = earlierCount > 0
    ? `There ${earlierCount === 1 ? "is 1 earlier message" : `are ${earlierCount} earlier messages`} in the conversation.`
    : "";
  const reason = recipientIsInterestedUser
    ? "You are receiving this because you messaged a landlord on Proximity. You can turn off message emails in your account settings."
    : "You are receiving this because a student messaged you about a listing on Proximity. You can turn off message emails in your account settings.";

  const nudge = reminder ? `Reminder: ${otherFirst} is still waiting for your reply.` : "";

  const small = (line) => `<p style="margin:0 0 6px">${line}</p>`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px 20px;color:#111827;font-size:15px;line-height:1.6">
      ${canReply ? `<p style="color:#c4c8cf;font-size:11px;margin:0 0 20px">Reply above this line to message ${escapeHtml(other)}.</p>` : ""}
      ${nudge ? `<p style="margin:0 0 18px;color:#6b7280;font-size:14px">${escapeHtml(nudge)}</p>` : ""}
      ${list
        .map((m, i) =>
          labels[i]
            ? `<p style="margin:0 0 2px;color:#9ca3af;font-size:12px">${escapeHtml(labels[i])}</p><p style="margin:0 0 18px">${chatMessageHtml(m)}</p>`
            : `<p style="margin:0 0 14px">${chatMessageHtml(m)}</p>`
        )
        .join("")}
      ${action ? `<a href="${action.url}" style="display:inline-block;margin:4px 0 8px;padding:10px 18px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(action.label)}</a>` : ""}
      <p style="margin:24px 0 0;color:#6b7280;font-size:14px;line-height:1.5">
        <span style="color:#111827;font-weight:600">${escapeHtml(other)}</span>${company ? `<br>${escapeHtml(company)}` : ""}<br>
        About <a href="${threadUrl}" style="color:#6b7280">${escapeHtml(about)}</a>
      </p>
      <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.5">
        ${small(how)}
        ${earlier ? small(earlier) : ""}
        ${small(reason)}
        <p style="margin:0">${POSTAL_ADDRESS}</p>
      </div>
    </div>
  `;

  const text = [
    canReply ? `Reply above this line to message ${other}.\n` : null,
    nudge ? `${nudge}\n` : null,
    ...list.map((m, i) => `${labels[i] ? `${labels[i]}\n` : ""}${chatMessageText(m)}\n`),
    action ? `${action.label}: ${action.url}\n` : null,
    other,
    company || null,
    `About ${about}`,
    threadUrl,
    "",
    canReply
      ? `Reply to this email and ${otherFirst} will see it on Proximity, or open the conversation: ${threadUrl}`
      : `Open the conversation on Proximity to reply: ${threadUrl}`,
    earlier || null,
    reason,
    POSTAL_ADDRESS,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { subject, fromName, html, text };
}

/*
 * A student's chat message, emailed to the landlord (or the listing contact the
 * alert is routed to) in the inquiry layout of lib/inquiryEmail.js (Wyatt,
 * 2026-11-18): their words first, signed with their name, From their name, and
 * the Proximity details under the "-- " line. The subject is a plain
 * "Inquiry about <listing>", the same for every alert in the conversation so
 * they stack into one email thread. Never the student's contact details.
 */
function buildLandlordChatEmail({
  senderName, listingTitle, listingAddress, subject: threadSubject, messages, earlierCount = 0,
  threadUrl, canReply, reminder = false, action = null, details = [], ownerFirst = null,
}) {
  const named = displayName(senderName, "");
  const other = named || "A student";
  const otherFirst = named ? named.split(/\s+/)[0] : "the student";
  const listingLabel = chatListingLabel({ listingTitle, listingAddress, subject: threadSubject });
  const list = Array.isArray(messages) ? messages : [];
  const labels = chatTimeLabels(list);
  const earlier = earlierCount > 0
    ? `There ${earlierCount === 1 ? "is 1 earlier message" : `are ${earlierCount} earlier messages`} in the conversation.`
    : null;
  const { html, text } = buildInquiryEmail({
    lead: reminder ? `Reminder, ${named ? otherFirst : "a student"} is still waiting on your reply.` : null,
    messages: list.map((m, i) => ({
      body: i === 0 ? stripOwnerGreeting(chatMessageText(m), ownerFirst) : chatMessageText(m),
      label: labels[i],
    })),
    signature: other,
    action,
    details: ["Message sent through Proximity (useproximity.org)", ...details, earlier],
    howToReply: canReply
      ? { text: `Reply to this email and ${otherFirst} sees it on Proximity, or`, link: { label: "open the conversation.", url: threadUrl } }
      : { text: "Reply on Proximity:", link: { label: "open the conversation.", url: threadUrl } },
    reason: "You are receiving this because a student messaged you about a listing on Proximity. You can turn off message emails in your account settings.",
    replyNotice: canReply ? landlordReplyNotice() : null,
  });
  return { subject: `Inquiry about ${listingLabel}`, fromName: named || "Proximity", html, text };
}

export async function sendChatMessageEmail({
  to,
  senderName,
  senderCompany,
  listingTitle,
  listingAddress,
  subject: threadSubject,
  messages,
  earlierCount = 0,
  recipientIsInterestedUser,
  threadUrl,
  replyTo,
  threadRef,
  references = [],
  testEmailTo,
  reminder = false,
  threadId = null,
  recipientId = null,
  // True when a review sandbox account is the sender or the recipient of this alert:
  // sendMailSafe then does not send it (it is only recorded as suppressed, see
  // lib/outreach.js). The caller leaves out the reply address and magic link for these.
  sandbox = false,
  action = null,
  details = [],
  ownerFirst = null,
}) {
  const build = (canReply) =>
    buildChatMessageEmail({
      senderName,
      senderCompany,
      listingTitle,
      listingAddress,
      subject: threadSubject,
      messages,
      earlierCount,
      recipientIsInterestedUser,
      threadUrl,
      canReply,
      reminder,
      action,
      details,
      ownerFirst,
    });
  const { subject, fromName } = build(false);

  // Threading: the real Message-IDs of the earlier alerts to this person in this
  // thread (oldest first), so every mail client stacks them as one conversation.
  // Before the first one there is nothing to reference, so a stable synthetic
  // root per (thread, recipient) stands in. SES assigns its own Message-ID.
  const root = threadRef ? `<${threadRef}@useproximity.org>` : null;
  const chain = [root, ...references].filter(Boolean);
  const headers = chain.length > 0
    ? { References: chain.join(" "), "In-Reply-To": chain[chain.length - 1] }
    : undefined;
  const fromAddress = replyTo && process.env.CHAT_FROM_REPLY_ADDRESS !== "0" ? replyTo : CHAT_FROM_ADDRESS;
  const from = { name: fromName, address: fromAddress };

  let sesError = null;
  if (sesTransporter && replyTo) {
    try {
      const { html, text } = build(true);
      const info = await sendMailSafe(sesTransporter, {
        logAs: { kind: reminder ? "chat_reminder" : "chat_alert", threadId, userId: recipientId, audience: recipientIsInterestedUser ? "student" : "landlord" },
        from,
        to,
        replyTo,
        subject,
        headers,
        html,
        text,
        ses: SES_SEND_OPTIONS,
        sandbox,
      }, testEmailTo);
      return { provider: "ses", messageId: info?.response || info?.messageId || null, suppressed: Boolean(info?.suppressed) };
    } catch (err) {
      console.error("sendChatMessageEmail: SES send failed, falling back to Gmail:", err);
      sesError = String(err?.message ?? err).slice(0, 300);
    }
  }

  // Gmail cannot send from the reply address, but it can carry it as the
  // Reply-To, so a reply still reaches the conversation.
  const { html, text } = build(Boolean(replyTo));
  const info = await sendMailSafe(transporter, {
    logAs: { kind: reminder ? "chat_reminder" : "chat_alert", threadId, userId: recipientId, audience: recipientIsInterestedUser ? "student" : "landlord" },
    from: { name: fromName, address: process.env.EMAIL_USER || CHAT_FROM_ADDRESS },
    to,
    ...(replyTo ? { replyTo } : {}),
    subject,
    headers,
    html,
    text,
    sandbox,
  }, testEmailTo);
  return { provider: "gmail", messageId: info?.messageId || null, suppressed: Boolean(info?.suppressed), sesError };
}

/*
 * A student's inquiry re-sent to a listing's contact address as a plain
 * inquiry from the student, so a leasing assistant such as EliseAI answers it
 * (Wyatt, 2026-11-17). From the chat's reply address through SES only, so the
 * answer comes back into the conversation and delivery is tracked. Resolves
 * to { id: the SES message id, suppressed }.
 */
export async function sendLeadInquiryEmail({ to, fromName, replyTo, subject, text, html, threadId, recipientId }) {
  if (!sesTransporter) throw new Error("Amazon SES is not configured");
  const info = await sendMailSafe(sesTransporter, {
    logAs: { kind: "chat_alert", threadId, userId: recipientId },
    from: { name: fromName, address: replyTo },
    to,
    replyTo,
    subject,
    text,
    html,
    ses: SES_SEND_OPTIONS,
  });
  return { id: info?.response || info?.messageId || null, suppressed: Boolean(info?.suppressed) };
}

/*
 * Internal email to the team (lib/chat/deliveryAlerts.js). Tries SES first and
 * Gmail second, so a report that one of the two is failing still gets out
 * through the other (Wyatt, 2026-10-23).
 */
export async function sendTeamEmail({ to, subject, html }) {
  if (sesTransporter) {
    try {
      return await sendMailSafe(sesTransporter, {
        logAs: { kind: "team_alert" },
        from: `"Proximity" <${CHAT_FROM_ADDRESS}>`,
        to,
        replyTo: "info@useproximity.org",
        subject,
        html,
      });
    } catch (err) {
      console.error("sendTeamEmail: SES send failed, falling back to Gmail:", err);
    }
  }
  return sendMailSafe(transporter, {
    logAs: { kind: "team_alert" },
    from: `"Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>`,
    to,
    replyTo: "info@useproximity.org",
    subject,
    html,
  });
}

/*
 * One email of an admin mass send (lib/massEmail/send.js). From and Reply-To are
 * both info@useproximity.org (Wyatt, 2026-11-07), so replies land in the team
 * inbox. Amazon SES first, for its delivery reports; Gmail if SES is not set up or
 * refuses it. Throws when both fail, so the caller can record the failure.
 *
 * Resolves to { provider, providerMessageId, suppressed, redirected } where
 * redirected means the outreach gate sent it to the test inbox (off production).
 */
export const MASS_EMAIL_ADDRESS = "info@useproximity.org";

// `audience` is the recipient's role: only a student's or parent's links carry
// marketing tags, so a landlord launch email never counts as a marketing visit.
export async function sendMassEmail({ to, subject, html, text = null, headers = null, attachments = [], userId = null, req = null, audience = null }) {
  const message = {
    logAs: { kind: "mass_email", userId, audience },
    to,
    replyTo: MASS_EMAIL_ADDRESS,
    subject,
    html,
    ...(text && { text }),
    ...(headers && { headers }),
    ...(attachments.length && { attachments }),
  };
  const outcome = (provider, info) => ({
    provider,
    providerMessageId: provider === "ses" ? info?.response ?? null : info?.messageId ?? null,
    suppressed: !!info?.suppressed,
    redirected: !info?.suppressed && !outreachEnabled(),
  });
  if (sesTransporter) {
    try {
      const info = await sendMailSafe(
        sesTransporter,
        { ...message, from: `"Proximity" <${MASS_EMAIL_ADDRESS}>`, ses: SES_SEND_OPTIONS },
        req
      );
      return outcome("ses", info);
    } catch (err) {
      console.error("sendMassEmail: SES send failed, falling back to Gmail:", err?.message ?? err);
    }
  }
  const info = await sendMailSafe(
    transporter,
    { ...message, from: `"Proximity" <${process.env.EMAIL_USER || MASS_EMAIL_ADDRESS}>` },
    req
  );
  return outcome("gmail", info);
}

// Why an emailed reply did not reach the conversation, in words the sender can
// act on. Keyed by chat_inbound_emails.status.
const NOT_DELIVERED_REASONS = {
  unknown_address:
    "This reply address is not connected to a conversation. It may be from an old or test email.",
  wrong_sender:
    "Replies have to come from the address the message alert was sent to, and forwarded emails cannot be posted.",
  empty:
    "We could not find a new message in your reply. Type your message above the quoted email and send it again.",
  rejected:
    "The conversation is no longer available, or too many messages were sent in a short time. Please try again in a few minutes.",
  awaiting_approval:
    "This address is not set up to reply for this landlord yet, so we have asked them to approve it. Your reply will be delivered as soon as they do.",
};

/*
 * Sent when an emailed reply could not be posted (lib/chat/inboundEmail.js), at
 * most once per sender per conversation per day. Marked Auto-Submitted so the
 * other side's out-of-office does not answer it and start a loop.
 */
export async function sendReplyNotDeliveredEmail({ to, reason, baseUrl }) {
  const why = NOT_DELIVERED_REASONS[reason] || NOT_DELIVERED_REASONS.rejected;
  const inboxUrl = `${baseUrl}/messages`;
  const waiting = reason === "awaiting_approval";
  const message = {
    from: `"Proximity" <${CHAT_FROM_ADDRESS}>`,
    to,
    subject: waiting ? "Your reply is waiting for approval" : "Your reply was not delivered",
    headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" },
    text: `${waiting ? "Your reply is waiting for approval." : "Your reply was not delivered."}\n\n${why}\n\nYou can always reply in the Proximity app:\n${inboxUrl}\n\n${POSTAL_ADDRESS}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        <h2 style="color:#111">${waiting ? "Your reply is waiting for approval" : "Your reply was not delivered"}</h2>
        <p>${escapeHtml(why)}</p>
        <p>You can always reply in the Proximity app.</p>
        <a href="${inboxUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Open your messages
        </a>
        ${emailFooter({ reason: "You are receiving this because you replied to a Proximity message alert." })}
      </div>
    `,
  };
  if (sesTransporter) {
    try {
      await sendMailSafe(sesTransporter, { logAs: { kind: "reply_not_delivered" }, ...message, ses: SES_SEND_OPTIONS });
      return;
    } catch (err) {
      console.error("sendReplyNotDeliveredEmail: SES send failed, falling back to Gmail:", err);
    }
  }
  await sendMailSafe(transporter, { logAs: { kind: "reply_not_delivered" }, ...message, from: `"Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>` });
}

// What was taken out of an emailed reply, in words the sender recognises.
// Keyed by the reasons from lib/chat/moderation.js.
const REMOVED_LABELS = {
  contact_email: "An email address",
  contact_phone: "A phone number",
  external_link: "A link to an outside website",
  social_handle: "A social media handle",
  off_platform_request: "A request to continue outside Proximity",
  irreversible_payment_rail: "A request for payment through gift cards, wire or cryptocurrency",
  off_platform_payment_request: "A request for payment through an app Proximity cannot protect",
  credential_phishing: "A request for login details",
  slur: "Abusive language",
  threat: "A threat",
};

/*
 * One email for everything Proximity took out of an emailed reply (Wyatt,
 * 2026-11-23): application links, contact details, payment and login
 * requests, abuse, and attachments that could not be posted. Says what
 * happened to the reply, lists what was removed, keeps a standing list of
 * what is always removed, then why and how. Sent every time, straight away,
 * from lib/chat/replyNote.js. Marked Auto-Submitted so an out-of-office does
 * not answer it.
 *
 * applicationLink: { message, actionLabel, url } when a landlord's application
 *   link was removed; the message is the same tailored copy the app shows.
 * unrestricted: a tour conversation, where contact details are allowed.
 */
export function buildReplyNoteEmail({
  audience = "student",
  otherFirst,
  delivered,
  reasons = [],
  attachmentsRemoved = false,
  applicationLink = null,
  unrestricted = false,
  conversationUrl,
}) {
  const landlord = audience === "landlord";
  const who = displayName(otherFirst, landlord ? "the student" : "the landlord");
  const opening = delivered
    ? `Your reply to ${who} was delivered, with some parts removed.`
    : `Your reply to ${who} wasn't delivered, because everything in it was removed.`;

  const items = [];
  if (applicationLink) items.push("Your application link");
  for (const label of [...new Set(reasons.map((r) => REMOVED_LABELS[r]).filter(Boolean))]) items.push(label);
  if (attachmentsRemoved) items.push("An attached file that shares contact details or asks for payment");

  const always = [
    ...(landlord ? ["application links"] : []),
    ...(unrestricted ? [] : ["phone numbers, email addresses, outside links and social media handles", "requests to continue outside Proximity"]),
    "requests for payment through gift cards, wire, cryptocurrency or apps Proximity cannot protect",
    "requests for login details",
    "abusive language and threats",
    "attachments that do any of these",
  ];
  const standing = `Proximity always removes ${always.slice(0, -1).join("; ")}; and ${always[always.length - 1]}.`;
  const tourNote = unrestricted ? " Contact details are fine in this conversation, since your tour is booked." : "";
  const why = stayOnProximityNote(audience, "email");
  const how = `Reply to Proximity's emails the way you would reply to ${who} directly, and your words land in the conversation.`;

  const listText = items.map((i) => `- ${i}`).join("\n");
  const linkText = applicationLink ? `\n\n${applicationLink.message}\n${applicationLink.actionLabel}: ${applicationLink.url}` : "";
  const text = `${opening}\n\nWhat we removed:\n${listText}${linkText}\n\n${standing}${tourNote}\n\n${why}\n\n${how}\n\nThe conversation on Proximity:\n${conversationUrl}\n\n${POSTAL_ADDRESS}`;

  const p = (body, extra = "") => `<p style="margin:0 0 14px${extra}">${body}</p>`;
  const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px 20px;color:#111827;font-size:15px;line-height:1.6">
        ${p(escapeHtml(opening))}
        <p style="margin:0 0 6px;font-weight:600">What we removed</p>
        <ul style="margin:0 0 14px;padding-left:20px">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        ${applicationLink ? `${p(escapeHtml(applicationLink.message))}
        <p style="margin:0 0 18px"><a href="${applicationLink.url}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${escapeHtml(applicationLink.actionLabel)}</a></p>` : ""}
        ${p(escapeHtml(`${standing}${tourNote}`), ";color:#4b5563")}
        ${p(escapeHtml(why))}
        ${p(escapeHtml(how))}
        ${p(`<a href="${conversationUrl}" style="color:#6b7280">The conversation on Proximity</a>`)}
        <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.5">
          <p style="margin:0 0 6px">You are receiving this because you replied to a Proximity message email.</p>
          <p style="margin:0">${POSTAL_ADDRESS}</p>
        </div>
      </div>
    `;
  return { subject: "A note about your reply", text, html };
}

export async function sendReplyNoteEmail({ to, ...rest }) {
  const built = buildReplyNoteEmail(rest);
  const message = {
    from: `"Proximity" <${CHAT_FROM_ADDRESS}>`,
    to,
    subject: built.subject,
    headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" },
    text: built.text,
    html: built.html,
  };
  if (sesTransporter) {
    try {
      await sendMailSafe(sesTransporter, { logAs: { kind: "reply_note" }, ...message, ses: SES_SEND_OPTIONS });
      return;
    } catch (err) {
      console.error("sendReplyNoteEmail: SES send failed, falling back to Gmail:", err);
    }
  }
  await sendMailSafe(transporter, { logAs: { kind: "reply_note" }, ...message, from: `"Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>` });
}

/*
 * Ask a landlord whether someone else may reply by email on their behalf
 * (lib/chat/replySenderApproval.js, Wyatt, 2026-10-24). Sent to the landlord's
 * own account email, once per sender, when a reply from an address that is not
 * theirs was held. The link opens the conversation, where they approve or
 * decline; the held reply is shown in the email so they know what is waiting.
 */
export function buildReplySenderApprovalEmail({ landlordFirst, senderName, senderEmail, studentFirst, listingLabel, preview, threadUrl }) {
  const who = senderName ? `${senderName} (${senderEmail})` : senderEmail;
  const student = displayName(studentFirst, "a student");
  const about = listingLabel ? ` about ${listingLabel}` : "";
  const intro = `${who} replied to ${student}${about} on your behalf. Their reply is waiting, because this address is not set up to reply for you.`;
  const ask = "If they work with you, approve them and the reply is delivered straight away. If you do not know them, choose \"Not them\" and nothing they send will be posted.";
  const expiry = "Held replies are kept for 30 days.";
  const quote = String(preview ?? "").trim();
  return {
    subject: `Can ${senderName || senderEmail} reply for you on Proximity?`,
    text: `Hi ${displayName(landlordFirst, "there")},\n\n${intro}\n\n${quote ? `Their reply:\n"${quote}"\n\n` : ""}${ask}\n\nReview it here:\n${threadUrl}\n\n${expiry}\n\n${POSTAL_ADDRESS}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px 20px;color:#111827;font-size:15px;line-height:1.6">
        <p style="margin:0 0 14px">Hi ${escapeHtml(displayName(landlordFirst, "there"))},</p>
        <p style="margin:0 0 14px">${escapeHtml(intro)}</p>
        ${quote ? `<blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid #e5e7eb;background:#f9fafb;color:#374151;white-space:pre-wrap">${escapeHtml(quote)}</blockquote>` : ""}
        <p style="margin:0 0 14px">${escapeHtml(ask)}</p>
        <a href="${threadUrl}"
           style="display:inline-block;margin:6px 0 16px;padding:12px 24px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Review the reply
        </a>
        <p style="margin:0 0 14px;color:#6b7280;font-size:13px">${escapeHtml(expiry)}</p>
        <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.5">
          <p style="margin:0 0 6px">You are receiving this because someone replied to a message sent to you on Proximity.</p>
          <p style="margin:0">${POSTAL_ADDRESS}</p>
        </div>
      </div>
    `,
  };
}

export async function sendReplySenderApprovalEmail({ to, ...input }) {
  const built = buildReplySenderApprovalEmail(input);
  const message = {
    from: `"Proximity" <${CHAT_FROM_ADDRESS}>`,
    to,
    subject: built.subject,
    headers: { "Auto-Submitted": "auto-generated" },
    text: built.text,
    html: built.html,
  };
  if (sesTransporter) {
    try {
      return await sendMailSafe(sesTransporter, { logAs: { kind: "reply_sender_approval" }, ...message, ses: SES_SEND_OPTIONS });
    } catch (err) {
      console.error("sendReplySenderApprovalEmail: SES send failed, falling back to Gmail:", err);
    }
  }
  return sendMailSafe(transporter, { logAs: { kind: "reply_sender_approval" }, ...message, from: `"Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>` });
}

// `next` is where to send them once verified, so someone who signed up in the
// middle of something (publishing a listing) lands back in it. The verify route
// sanitizes it again, so the link is not trusted just because we built it.
export async function sendVerificationEmail({ email, name, token, baseUrl, next, req }) {
  const verifyUrl = buildVerifyUrl({ baseUrl, token, next });
  await sendMailSafe(
    transporter,
    {
      logAs: { kind: "verification" },
      from: `"Proximity" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify your Proximity account",
      html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Welcome to Proximity${name ? `, ${escapeHtml(name)}` : ""}!</h2>
        <p>Click the button below to verify your email address. This link expires in 24 hours.</p>
        <a href="${verifyUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Verify Email
        </a>
        <p style="color:#666;font-size:14px">Or copy this link:<br>${verifyUrl}</p>
        ${emailFooter({
          reason: "You are receiving this because this address was used to create a Proximity account.",
        })}
      </div>
    `,
    },
    req
  );
}

/*
 * One-click confirmation for a per-listing alert address. Until someone at this
 * address clicks through, chat alerts for the listing keep going to the
 * landlord account's own email, see fn_chat_alert_email.
 *
 * Says plainly what the address is being signed up for, and that the
 * conversations stay in the landlord's account, so a leasing office that never
 * asked for this can tell what it is and ignore it.
 */
export async function sendContactVerificationEmail({ to, landlordName, listingLabel, confirmUrl, testEmailTo }) {
  const landlord = escapeHtml(landlordName || "A landlord");
  const listing = listingLabel ? escapeHtml(listingLabel) : "";
  const subject = listingLabel
    ? `Confirm message alerts for ${listingLabel}`
    : "Confirm this address for Proximity message alerts";
  const message = {
    from: `"Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>`,
    to,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        <h2 style="color:#111">Confirm this address for message alerts</h2>
        <p><strong>${landlord}</strong> wants students&#39; messages${listing ? ` about <strong>${listing}</strong>` : ""} sent to this address.</p>
        <p>Once you confirm, each new message arrives here as an email, with the full text of the message and the sender&#39;s name. Reply directly to the email and your reply is posted to the conversation in ${landlord}&#39;s Proximity account. Copies of these emails stay in this inbox, so anyone who can read it can read the messages.</p>
        <a href="${confirmUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Confirm this address
        </a>
        <p style="color:#666;font-size:14px">Or copy this link:<br>${confirmUrl}</p>
        <p style="color:#999;font-size:12px">If you don&#39;t recognize this, ignore it. Nothing will be sent here unless you confirm. The link expires in 7 days.</p>
        ${emailFooter({
          reason: "You are receiving this because a landlord on Proximity entered this address as the contact for one of their listings.",
        })}
      </div>
    `,
  };
  // Same sender as the alerts this address will get, so a first alert from SES
  // is not the first time the inbox sees it.
  if (sesTransporter) {
    try {
      await sendMailSafe(sesTransporter, { logAs: { kind: "contact_verification" }, ...message, from: `"Proximity" <${CHAT_FROM_ADDRESS}>`, ses: SES_SEND_OPTIONS }, testEmailTo);
      return;
    } catch (err) {
      console.error("sendContactVerificationEmail: SES send failed, falling back to Gmail:", err);
    }
  }
  await sendMailSafe(transporter, { ...message, logAs: { kind: "contact_verification" } }, testEmailTo);
}

// One email per PMS sync run, only when a human should look: errored or
// guard-held connections, suppressed delists, and dry-run connections with
// intended changes waiting for review. Sent to PMS_ALERT_EMAIL or all supers.
export async function sendPmsSyncDigestEmail({ to, items, baseUrl }) {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // i.note is our own trusted HTML (may carry the hold-release link);
  // provider and landlord are data and get escaped.
  const rows = items
    .map(
      (i) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;font-weight:600;text-transform:capitalize">${esc(i.provider)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee">${esc(i.landlord)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee">${i.note}</td>
        </tr>`
    )
    .join("");
  await sendMailSafe(transporter, {
    logAs: { kind: "pms_sync_digest" },
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to,
    subject: `PMS sync: ${items.length} connection${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} a look`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111">
        <h2 style="color:#111">PMS sync digest</h2>
        <p style="color:#444">Today's sync flagged the following. Nothing here was applied
           without its safety checks; anything held is waiting on you.</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <tr>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #111">System</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #111">Landlord</th>
            <th align="left" style="padding:8px 10px;border-bottom:2px solid #111">What happened</th>
          </tr>
          ${rows}
        </table>
        <p style="color:#666;font-size:13px;margin-top:16px">
          Full detail lives in pms_sync_events and pms_review_queue${baseUrl ? ` (${baseUrl})` : ""}.
        </p>
        ${emailFooter({
          reason: "You are receiving this because you administer PMS connections on Proximity.",
        })}
      </div>
    `,
  });
}
/*
 * The one email a reviewer gets after reviewing.
 *
 * It replaces a pair that used to fire back-to-back — a "your review is live"
 * note and a separate "finish setting up your account" welcome — which meant a
 * new reviewer received two emails within a second of each other, both
 * announcing the same thing. There is now one, sent once per REVIEWER rather
 * than once per review, so someone who reviewed three places hears about all
 * three together. lib/reviews/confirmation.js decides when it goes out.
 *
 * `places` is every place they just reviewed. Names are escaped rather than
 * trusted: a stub listing's address comes from whatever the reviewer picked in
 * the Mapbox autocomplete, so it is not our text.
 *
 * `setupToken` is what splits the two versions. When the account still has a
 * profile to finish, the CTA is that — it is the only thing standing between
 * them and an account they can sign into. When there is nothing to finish, the
 * CTA is matchmaking, because a review is the moment a student has proved they
 * care and the moment they are most likely to come back.
 */
// `sandbox`: the reviewer is a review sandbox account, so the email is only recorded.
export async function sendReviewConfirmationEmail({ email, name, baseUrl, places, setupToken, sandbox = false }) {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const list = (places ?? []).filter(Boolean);
  const safe = list.map(esc);
  // "A", "A and B", "A, B and C" — the subject and body both read as a sentence.
  const phrase =
    safe.length === 0
      ? "your place"
      : safe.length === 1
      ? safe[0]
      : `${safe.slice(0, -1).join(", ")} and ${safe[safe.length - 1]}`;
  const plural = list.length > 1;
  const firstName = name ? esc(String(name).split(" ")[0]) : "";

  const subject = plural
    ? `Your ${list.length} reviews are live`
    : `Your review of ${list[0] || "your place"} is live`;

  const ctaUrl = setupToken ? `${baseUrl}/review/finish?token=${setupToken}` : `${baseUrl}/find-your-place`;
  const ctaLabel = setupToken ? "Finish my profile" : "Find Your Place";

  const tail = setupToken
    ? `<p style="font-size:15px;line-height:1.6;color:#333">
         We started an account for you so you can edit ${plural ? "them" : "it"}, save places
         and message landlords. Finish setting it up, it takes about a minute:
       </p>`
    : `<p style="font-size:15px;line-height:1.6;color:#333">
         Proximity is free for students. When you&#39;re looking for your next place, we
         match you on budget, priorities, and reviews like the ${plural ? "ones" : "one"} you just wrote.
       </p>`;

  await sendMailSafe(transporter, {
    logAs: { kind: "review_confirmation" },
    sandbox,
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: email,
    replyTo: OPT_OUT_INBOX,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        <h2 style="color:#111;font-size:20px;margin:0 0 16px">
          ${firstName ? `${firstName}, your` : "Your"} review${plural ? "s" : ""} of ${phrase}
          ${plural ? "are" : "is"} live.
        </h2>
        <p style="font-size:15px;line-height:1.6;color:#333">
          Students move out every year and take what they learned about the building with
          them. Now, yours stays. It&#39;s what the next person sees before they sign.
        </p>
        ${tail}
        <a href="${ctaUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          ${ctaLabel}
        </a>
        <p style="color:#666;font-size:14px">Or copy this link:<br>${ctaUrl}</p>
        ${
          setupToken
            ? `<p style="color:#999;font-size:12px">This link works for 7 days. You can also sign in
                 any time with Google using this email address.</p>`
            : ""
        }
        ${emailFooter({
          reason: "You are receiving this because you wrote a review on Proximity using this address.",
          commercial: true,
        })}
      </div>
    `,
  });
}

/*
 * The nudge for a waitlist lead who never finished their account.
 *
 * They gave us a name to reach a landlord's waitlist and an account was created
 * from it. Half an hour later, if they still have no way to sign in, this is the
 * one message that tells them the account exists at all.
 *
 * Deliberately says nothing about which waitlist. Naming the building would tell
 * whoever opens this inbox what the person typed into a form somewhere, and the
 * address is unverified: it may not be theirs. The account is the only thing
 * this email is actually about, so it is the only thing it mentions.
 *
 * Sent at most once per person (waitlist_clicks.nudge_sent_at), and never to
 * someone who already has credentials.
 */
export async function sendWaitlistNudgeEmail({ email, name, baseUrl, setupToken }) {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const firstName = name ? esc(String(name).split(" ")[0]) : "";
  const ctaUrl = `${baseUrl}/review/finish?token=${setupToken}`;

  await sendMailSafe(transporter, {
    logAs: { kind: "waitlist_nudge" },
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Finish setting up your Proximity account`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        <h2 style="color:#111;font-size:20px;margin:0 0 16px">
          ${firstName ? `${firstName}, your` : "Your"} Proximity account is almost ready.
        </h2>
        <p style="font-size:15px;line-height:1.6;color:#333">
          We started an account for you. It just needs a password before you can sign in
          and use it to track places, save listings and message landlords.
        </p>
        <a href="${ctaUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Finish my account
        </a>
        <p style="color:#666;font-size:14px">Or copy this link:<br>${ctaUrl}</p>
        <p style="color:#999;font-size:12px">
          This link works for 7 days. If you weren&#39;t expecting this, you can ignore this
          email and the account will stay unusable.
        </p>
        ${emailFooter({
          reason: "You are receiving this because this address was used to join a waitlist on Proximity.",
        })}
      </div>
    `,
  });
}

/*
 * The WashU parent housing guide, sent to whoever asks for it on /parent-signup.
 *
 * Goes through the Gmail transporter so it comes from info@useproximity.org like
 * the rest of our account mail (Wyatt, 2026-10-30). The highlights are a short
 * teaser of the guide page, not a copy of it: the page stays the one place the
 * guide is kept up to date. Anyone can type any address into the form, so the
 * email asks nothing of the reader and links only to the public guide.
 */
export async function sendParentGuideEmail({ email, firstName, baseUrl, req }) {
  const greetingName = firstName ? escapeHtml(String(firstName).split(" ")[0]) : "";
  const guideUrl = `${baseUrl}/guides/washu-parent-guide`;

  const highlights = [
    ["First and second years live on campus.", "WashU requires it, so the real decision starts in sophomore spring."],
    ["Off-campus can save $7,000+ a year.", "On-campus runs up to $19,500. Students off campus report $800 to $1,000 a month."],
    ["There are four kinds of off-campus housing.", "Loop walk-ups, Delmar apartments, CWE and Clayton complexes, and houses. Each trades price, space and distance differently."],
    ["Reviews matter more than listings.", "Most students sign without hearing from anyone who has lived there. Verified student reviews close that gap."],
  ];

  const highlightsHtml = highlights
    .map(
      ([title, body]) => `
        <tr>
          <td style="padding:0 0 14px;vertical-align:top;width:22px;color:#ef4444;font-weight:700;font-size:15px">&#10003;</td>
          <td style="padding:0 0 14px;font-size:15px;line-height:1.55;color:#333">
            <strong style="color:#111">${title}</strong> ${body}
          </td>
        </tr>`
    )
    .join("");

  await sendMailSafe(
    transporter,
    {
      logAs: { kind: "parent_guide" },
      from: `"Proximity" <${process.env.EMAIL_USER}>`,
      to: email,
      replyTo: OPT_OUT_INBOX,
      subject: "Your WashU parent housing guide",
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h2 style="color:#111;font-size:22px;line-height:1.3;margin:0 0 12px">
            ${greetingName ? `Hi ${greetingName}, here` : "Here"} is your WashU housing guide.
          </h2>
          <p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 20px">
            Everything families should know before their student signs a lease near WashU,
            from dorm rules to what off-campus really costs.
          </p>
          <a href="${guideUrl}"
             style="display:inline-block;margin:0 0 24px;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
            Read the full guide
          </a>
          <p style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ef4444;margin:0 0 12px">
            The short version
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
            ${highlightsHtml}
          </table>
          <p style="font-size:15px;line-height:1.6;color:#333;margin:8px 0 0">
            When your student starts looking, they can browse vetted listings and read reviews
            from other WashU students at <a href="${baseUrl}" style="color:#ef4444">useproximity.org</a>.
          </p>
          ${emailFooter({
            reason: "You are receiving this because this address asked for the WashU parent guide on Proximity.",
            commercial: true,
          })}
        </div>
      `,
    },
    req
  );
}

// Any value a user typed gets escaped (lib/escapeHtml) before it is interpolated into
// an email body. Chat matters most: a message is typed by one user and rendered in
// another user's inbox, so escaping is what stops a body from smuggling markup into it.

/*
 * The placeholders an admin may use in a bulk invite message. Exported so the
 * composer's help text, its validation and this renderer cannot drift apart.
 */
export const INVITE_PLACEHOLDERS = ["{first_name}", "{link}"];

/**
 * Turn an admin's plain-text message into the body of one person's email.
 *
 * Escape first, THEN substitute. Doing it the other way round would escape the
 * anchor we just built and mail people a visible <a href=...>. The braces in the
 * placeholders survive escaping untouched, which is what makes that order safe.
 *
 * The admin's text is trusted enough to send but not trusted as markup: they are
 * writing a message, not HTML, and a stray < in "rent < $900" should read as a
 * less-than sign rather than eat the rest of the paragraph.
 */
export function renderInviteMessage(message, { firstName, inviteUrl }) {
  const name = firstName ? String(firstName).split(" ")[0] : "";
  const link =
    `<a href="${inviteUrl}" style="color:#dc2626;font-weight:600">Write my review</a>`;

  return escapeHtml(message)
    .split(/\n{2,}/)
    .map((para) => {
      const html = para
        .split("\n")
        .join("<br>")
        .split("{first_name}")
        .join(escapeHtml(name))
        .split("{link}")
        .join(link);
      return `<p style="font-size:15px;line-height:1.6;color:#333">${html}</p>`;
    })
    .join("");
}

/*
 * The review invite: a link that only works from one inbox.
 *
 * Everything the review flow normally takes on trust (who you are, that the
 * school email you typed is yours) is instead carried by the token in this URL.
 * So the footer has to make the personal nature of the link obvious, because the
 * one behaviour that breaks the guarantee is forwarding it to a friend: whoever
 * opens it posts under THIS address. That footer is appended to every invite,
 * custom message or not, because it is a property of the link rather than of
 * whatever the admin chose to say above it.
 *
 * `message` is an admin-written template (see renderInviteMessage). Without one
 * the default copy below is used, which is what a one-off invite sends.
 *
 * `firstName` comes from the roster when we have it. It is escaped rather than
 * trusted: roster rows are bulk-imported from a file, not typed by us.
 */
export async function sendReviewInviteEmail({
  email,
  firstName,
  token,
  baseUrl,
  expiresAt,
  subject,
  message,
}) {
  const inviteUrl = `${baseUrl}/review-invite/t/${encodeURIComponent(token)}`;
  const name = firstName ? escapeHtml(String(firstName).split(" ")[0]) : "";
  const expiryNote = expiresAt
    ? `This link works until ${new Date(expiresAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })}.`
    : "";

  const defaultBody = `
        <h2 style="color:#111;font-size:20px;margin:0 0 16px">
          ${name ? `${name}, what` : "What"} was your place actually like?
        </h2>
        <p style="font-size:15px;line-height:1.6;color:#333">
          Proximity is where WashU students find off-campus housing. The part that
          makes it useful is the reviews, and the only people who can write them are
          the students who lived there.
        </p>
        <p style="font-size:15px;line-height:1.6;color:#333">
          It takes about two minutes and there is no account to create first.
        </p>
        <a href="${inviteUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Write my review
        </a>`;

  const body = message
    ? renderInviteMessage(message, { firstName, inviteUrl })
    : defaultBody;

  await sendMailSafe(transporter, {
    logAs: { kind: "review_invite" },
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: email,
    replyTo: "info@useproximity.org",
    subject: subject?.trim() || "Where did you live this year?",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        ${body}
        <p style="color:#666;font-size:14px">Or copy this link:<br>${inviteUrl}</p>
        <p style="color:#999;font-size:12px;line-height:1.5">
          This link is personal to ${escapeHtml(email)} and posts your review under
          that address, so please don&#39;t forward it. ${expiryNote}
        </p>
        ${emailFooter({
          reason:
            "This is an invitation from Proximity, an off-campus housing marketplace for university students.",
          commercial: true,
        })}
      </div>
    `,
  });
}

/*
 * One short note to the team per new review or reply report, so a report gets
 * looked at instead of sitting in review_reports / review_reply_reports.
 * Everything but our own labels is user text and is escaped. Off production
 * sendMailSafe redirects it to the tester's inbox or drops it.
 */
export async function sendContentReportEmail({
  kind,
  text,
  author,
  reporter,
  listingLabel,
  listingUrl,
  req,
}) {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  await sendMailSafe(
    transporter,
    {
      logAs: { kind: "content_report" },
      from: `"Proximity" <${process.env.EMAIL_USER}>`,
      to: "info@useproximity.org",
      subject: `Reported ${kind}${listingLabel ? `: ${listingLabel}` : ""}`,
      html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111;font-size:14px">
        <p>A ${esc(kind)} was reported${listingLabel ? ` on <b>${esc(listingLabel)}</b>` : ""}.</p>
        <blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #ef4444;color:#333">${esc(text)}</blockquote>
        <p style="color:#444">Written by ${esc(author)}<br>Reported by ${esc(reporter)}</p>
        ${listingUrl ? `<p><a href="${esc(listingUrl)}">Open the listing</a></p>` : ""}
      </div>
    `,
    },
    req
  );
}

/*
 * Source sync (the weekly re-read of landlord websites, lib/sourceImport).
 *
 * One digest per run naming every listing that changed, was held for a
 * person, or failed, with the applied and proposed changes under each. The
 * failure email goes out immediately, per listing, because a site that
 * stopped answering is worth knowing about before the digest.
 */

function describeChange(c) {
  const where = c.detail?.label ? `${escapeHtml(c.detail.label)}: ` : "";
  const money = (n) => (n == null ? "no price" : `$${Number(n).toLocaleString("en-US")}`);
  switch (c.kind) {
    case "lease_new":
      return `${where}new lease at ${money(c.new?.rent)}${c.new?.rentIsPerPerson ? " per person" : ""}${(c.new?.leaseTermMonths ?? []).length ? ` (${c.new.leaseTermMonths.join(", ")} months)` : ""}`;
    case "lease_withdrawn":
      return `${where}lease at ${money(c.detail?.rent)} no longer offered, marked unavailable`;
    case "lease_updated":
      return `${where}lease details updated (${escapeHtml(c.field)})`;
    case "unit_relisted":
      return `${where}lease is back on the website`;
    case "unit_new":
      return `${where}new floor plan on the website${c.new?.offers ? `, ${c.new.offers} price${c.new.offers === 1 ? "" : "s"}` : ""}`;
    case "unit_updated":
      return `${where}unit details filled in (${escapeHtml(c.field)})`;
    case "spec_mismatch":
      return `${where}bed/bath/size differ from the website (${escapeHtml(JSON.stringify(c.old))} vs ${escapeHtml(JSON.stringify(c.new))})`;
    case "missing_unit":
      return `${where}no longer on the website`;
    case "property_updated":
      return `property details filled in`;
    case "photos_added":
      return `${where}${c.new} photo${c.new === 1 ? "" : "s"} added`;
    default:
      return `${where}${escapeHtml(c.kind)}`;
  }
}

/* A synced listing worth a line in the digest: it changed, was held or failed, or its leasing portal was not read. */
export const needsLook = (i) => (i.status !== "unchanged" && i.status !== "ok") || !!i.portalUnread;

/*
 * What a leasing portal that was not read means for the listing. When the
 * portal priced it before, the listing keeps those prices; a portal never
 * read yet leaves the website's own prices in use.
 */
export const portalUnreadLine = (i) =>
  `Leasing portal not read: ${i.portalUnread}. ${i.portalUnreadKept === false ? "This listing has not been priced from the portal yet, so the website's own prices were read instead" : "Prices and lease lengths were not refreshed; the listing keeps the ones it had"}. Check the portal by hand.`;

export async function sendSourceSyncDigestEmail({ to, items, baseUrl }) {
  const block = (i) => {
    const link = `${baseUrl}/dashboard/admin/listings?listing=${encodeURIComponent(i.listingId)}`;
    const head = `<p style="margin:16px 0 4px"><strong>${escapeHtml(i.listing)}</strong> <span style="color:#666">(${escapeHtml(i.status)}${i.platform ? `, ${escapeHtml(i.platform)}` : ""}${i.confidence ? `, ${escapeHtml(i.confidence)} confidence` : ""})</span><br><a href="${link}" style="color:#dc2626;font-size:12px">open in admin</a></p>`;
    if (i.status === "failed") return `${head}<p style="color:#b91c1c;margin:0">Failed: ${escapeHtml(i.error)}</p>`;
    const applied = (i.applied ?? []).map((c) => `<li>${describeChange(c)}</li>`).join("");
    const held = (i.held ?? []).map((c) => `<li>${describeChange(c)}${c.detail?.judge?.reason ? ` <span style="color:#666">(${escapeHtml(c.detail.judge.reason)})</span>` : ""}</li>`).join("");
    // Denied by the sync itself (lib/sourceImport/syncPolicy.js), with why.
    const denied = (i.denied ?? []).filter((c) => c.denyReason !== "too much changed at once, so the whole run was skipped").map((c) => `<li>${describeChange(c)} <span style="color:#666">(${escapeHtml(c.denyReason ?? "denied")})</span></li>`).join("");
    const hold = i.holdReason
      ? `<p style="color:#b45309;margin:4px 0">${i.holdReason === "churn_hold" ? "Skipped: more than a fifth of the leases would change at once, which is more likely a misread than a building re-let overnight. Nothing was applied: the changes below wait in admin, under Agents, for the team or the landlord to apply or reject" : "Held: the reader was not confident in this read. Nothing was applied"}.</p>`
      : "";
    // The building's leasing portal (where its real prices live) was found
    // but read nothing: its prices were not refreshed.
    const portal = i.portalUnread
      ? `<p style="color:#b45309;margin:4px 0">${escapeHtml(portalUnreadLine(i))}</p>`
      : "";
    return `${head}${hold}${portal}${applied ? `<p style="margin:4px 0 2px;color:#166534">Applied</p><ul style="margin:0 0 6px 18px;padding:0">${applied}</ul>` : ""}${denied ? `<p style="margin:4px 0 2px;color:#6b7280">Not applied</p><ul style="margin:0 0 6px 18px;padding:0">${denied}</ul>` : ""}${held ? `<p style="margin:4px 0 2px;color:#b45309">Needs a look</p><ul style="margin:0 0 6px 18px;padding:0">${held}</ul>` : ""}`;
  };
  const changed = items.filter(needsLook);
  const quiet = items.length - changed.length;
  await sendMailSafe(transporter, {
    logAs: { kind: "source_sync_digest" },
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Website sync: ${changed.length} listing${changed.length === 1 ? "" : "s"} changed or need a look`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;font-size:14px">
        <h2 style="color:#111">Website sync digest</h2>
        <p style="color:#444">${items.length} listing${items.length === 1 ? "" : "s"} checked against ${items.length === 1 ? "its" : "their"} landlord${items.length === 1 ? "'s" : "s'"} website${items.length === 1 ? "" : "s"}. ${quiet} unchanged.</p>
        ${changed.map(block).join("")}
        <p style="color:#666;font-size:12px;margin-top:16px">Every change above is in listing_source_events. The sync applies or declines each change itself, except a skipped run: its changes, under "Needs a look", wait in <a href="${baseUrl}/dashboard/admin/agents" style="color:#666">admin Agents</a> until the team or the landlord applies or rejects them.</p>
        ${emailFooter({ reason: "You are receiving this because you administer listing sources on Proximity." })}
      </div>`,
  });
}

export async function sendSourceSyncFailureEmail({ to, listing, listingId, sourceUrl, error, failures, baseUrl }) {
  await sendMailSafe(transporter, {
    logAs: { kind: "source_sync_failure" },
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Website sync failed: ${listing}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;font-size:14px">
        <h2 style="color:#111">Website sync failed</h2>
        <p><strong>${escapeHtml(listing)}</strong> could not be read from <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a>.</p>
        <p style="color:#b91c1c">${escapeHtml(error)}</p>
        <p style="color:#444">Failure ${failures} in a row. The listing was left as it was; the next check is pushed back accordingly.</p>
        <p><a href="${baseUrl}/dashboard/admin/listings?listing=${encodeURIComponent(listingId)}" style="color:#dc2626">Open in admin</a></p>
        ${emailFooter({ reason: "You are receiving this because you administer listing sources on Proximity." })}
      </div>`,
  });
}

/*
 * A sync skipped a listing because too much changed at once (the churn guard
 * in lib/sourceImport/apply.js). Sent the first time in a row, not every day.
 */
export async function sendSourceSyncSkippedEmail({ to, listing, listingId, sourceUrl, touched, existing, newUnits = 0, units = 0, baseUrl }) {
  const what =
    newUnits > 4 || (units >= 1 && newUnits > units)
      ? `added ${Number(newUnits)} new unit${Number(newUnits) === 1 ? "" : "s"} to a listing of ${Number(units)}`
      : `changed ${Number(touched)} of the ${Number(existing)} leases`;
  await sendMailSafe(transporter, {
    logAs: { kind: "source_sync_skipped" },
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Website sync skipped: ${listing}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;font-size:14px">
        <h2 style="color:#111">Website sync skipped a listing</h2>
        <p>Reading <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a> would have ${what} on <strong>${escapeHtml(listing)}</strong> at once. That is more likely a misread (or another building on the same website) than a real overnight change, so nothing was applied.</p>
        <p style="color:#444">The changes are waiting for the team in admin, under Agents, "Website changes waiting for the team", each shown as Proximity now against the website. Apply them if the website really did change, or reject them if it was a misread. The landlord sees them on the listing's Agent tab and can apply or reject them too. Until then students see the current listing. Tomorrow's read replaces them if the website changes again.</p>
        <p><a href="${baseUrl}/dashboard/admin/agents" style="color:#dc2626">Review the changes</a> · <a href="${baseUrl}/dashboard/admin/listings?listing=${encodeURIComponent(listingId)}" style="color:#6b7280">Open the listing</a></p>
        ${emailFooter({ reason: "You are receiving this because you administer listing sources on Proximity." })}
      </div>`,
  });
}

/* The importer hit a site-wide cap: every import is paused until the window passes. */
export async function sendImportCapAlertEmail({ to, kind, used, limit, hours }) {
  await sendMailSafe(transporter, {
    logAs: { kind: "import_cap_alert" },
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Website imports paused: ${kind} cap reached`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;font-size:14px">
        <h2 style="color:#111">Website imports paused</h2>
        <p>The site-wide cap on ${escapeHtml(kind)} reads was reached: ${Number(used)} of ${Number(limit)} in the last ${Number(hours)} hours.</p>
        <p style="color:#444">Landlords are told to try again later until the window passes. If this is real demand, raise the cap (IMPORT_GLOBAL_* settings). If it is not, check listing_import_usage for the accounts behind it.</p>
        ${emailFooter({ reason: "You are receiving this because you administer listing imports on Proximity." })}
      </div>`,
  });
}

/* ─── Per-listing agents (Proxy) ─────────────────────────────────────────── */

function proxyParagraphs(messages) {
  return (messages ?? []).map((m) =>
    `<div style="margin:10px 0;padding:12px 14px;background:#f9fafb;border-left:3px solid #ef4444;border-radius:6px;white-space:pre-wrap">${escapeHtml(String(m))}</div>`
  ).join("");
}

/*
 * To a student who has left the listing page: Proxy answered, or relayed the
 * landlord's answer, or has no answer yet. Never names the landlord.
 */
export async function sendProxyStudentEmail({ to, name, kind, listingLabel, messages, threadUrl, threadId = null, userId = null, testEmailTo = null, replyTo = null, sandbox = false }) {
  const first = name ? String(name).split(" ")[0] : "";
  const subject = {
    proxy_relay: `The landlord answered your question about ${listingLabel}`,
    proxy_clarifier: `The landlord has a question for you about ${listingLabel}`,
    proxy_correction: `An update from the landlord about ${listingLabel}`,
    proxy_no_answer: `No answer yet about ${listingLabel}`,
    proxy_reply: `Re: your question about ${listingLabel}`,
  }[kind] ?? `Proxy answered your question about ${listingLabel}`;
  const intro = {
    proxy_relay: "The landlord's answer came back.",
    proxy_clarifier: "The landlord needs one detail from you before they can answer.",
    proxy_correction: "The landlord updated something Proxy told you.",
    proxy_no_answer: "An update on your question.",
    proxy_reply: "Here's Proxy's reply.",
  }[kind] ?? "Here is what Proxy found.";
  await sendMailSafe(transporter, {
    logAs: { kind, threadId, userId },
    // A review sandbox student is never emailed (same rule as every other email).
    sandbox,
    from: `"Proxy at Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>`,
    to,
    // Replying goes to Proxy in the same conversation (Wyatt, 2026-11-01).
    ...(replyTo ? { replyTo } : {}),
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111;font-size:14px">
        <p>${first ? `Hi ${escapeHtml(first)},` : "Hi,"}</p>
        <p>${intro} About <strong>${escapeHtml(listingLabel)}</strong>:</p>
        ${proxyParagraphs(messages)}
        <a href="${threadUrl}" style="display:inline-block;margin:16px 0;padding:11px 20px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Open the conversation</a>
        ${replyTo ? `<p style="color:#444">Reply to this email to ask Proxy anything else.</p>` : ""}
        <p style="color:#666;font-size:12px">Proxy is an automated assistant. Its answers are compiled from several sources and may be inaccurate or out of date; confirm anything important with the landlord before signing.</p>
        ${emailFooter({ reason: "You are receiving this because you asked Proxy about a listing on Proximity." })}
      </div>`,
  }, testEmailTo);
}

/*
 * To a signed-out visitor who gave Proxy their email: confirm it is theirs
 * before anything else is sent there (PR #365 review). Nothing about the
 * listing's answers is in this email.
 */
export async function sendProxyConfirmEmail({ to, listingLabel, confirmUrl, threadId = null, testEmailTo = null }) {
  await sendMailSafe(transporter, {
    logAs: { kind: "proxy_confirm_email", threadId },
    from: `"Proxy at Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>`,
    to,
    subject: "Confirm your email for Proxy",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111;font-size:14px">
        <p>Hi,</p>
        <p>Someone asked Proxy to email this address when the landlord answers a question about <strong>${escapeHtml(listingLabel)}</strong> on Proximity. If that was you, confirm below and the answer will be emailed here.</p>
        <a href="${confirmUrl}" style="display:inline-block;margin:16px 0;padding:11px 20px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Confirm my email</a>
        <p style="color:#666;font-size:12px">If it wasn't you, ignore this email and nothing more will be sent. The link works for 2 days.</p>
        ${emailFooter({ reason: "You are receiving this because this address was given to Proxy on Proximity." })}
      </div>`,
  }, testEmailTo);
}

/*
 * To a landlord: a student's question Proxy could not answer (or a reminder,
 * or the student's reply to a clarifying question). The student is never
 * named, and the question names the listing, not a lease (2026-10-29).
 * A contact with no account yet is asked to create one to answer.
 */
/*
 * A question Proxy could not answer, sent to the listing's landlord (or its
 * routed contact), in the inquiry layout of lib/inquiryEmail.js (Wyatt,
 * 2026-11-18): the question first, signed "A student" (never a name or contact
 * details), then what Proxy is and how to answer below the "-- " line. The
 * student's reply to a clarifying question leads its own email with the
 * original question quoted under it, and a reminder adds one line on top.
 * Every variant has the same "Question about <listing>" subject so they stack.
 */
export function buildProxyLandlordQuestionEmail({
  listingLabel, question, queueUrl, hasAccount = true, studentReply = null, reminderDay = null, canReply = false,
}) {
  const reply = String(studentReply ?? "").trim();
  const asked = hasAccount
    ? canReply
      ? "Reply to this email with your answer, or answer in the app. If you need something from the student first, just ask it in your reply."
      : "Answer in the app and Proxy passes it on to the student."
    : `This address is listed as the contact for ${listingLabel} on Proximity. Create an account with it to answer students' questions.`;
  const { html, text } = buildInquiryEmail({
    lead: reminderDay ? "Reminder, a student is still waiting on your answer." : null,
    messages: [{ body: reply || question }],
    quoted: reply ? { label: "Their original question:", body: question } : null,
    // No signature (Wyatt, 2026-11-20): the building it was asked about instead.
    signature: `Asked about ${listingLabel}`,
    details: [
      `Asked through Proxy, the assistant on your Proximity listing. Your answer is saved for future students and passed on to the student.`,
      asked,
    ],
    button: { label: hasAccount ? "Answer in the app" : "Create an account to answer", url: queueUrl },
    reason: "You are receiving this because you are the contact for a listing on Proximity.",
  });
  return { subject: `Question about ${listingLabel}`, html, text };
}

export async function sendProxyLandlordQuestionEmail({
  to, listingLabel, question, queueUrl, kind = "proxy_question",
  hasAccount = true, studentReply = null, reminderDay = null, replyTo = null, sandbox = false,
}) {
  // With a per-question reply address, answering the email answers the student.
  const canReply = !!replyTo && hasAccount;
  const { subject, html, text } = buildProxyLandlordQuestionEmail({ listingLabel, question, queueUrl, hasAccount, studentReply, reminderDay, canReply });
  await sendMailSafe(transporter, {
    logAs: { kind, audience: "landlord" },
    // A review sandbox question (asked by, or sent to, a sandbox account) is never sent.
    sandbox,
    from: `"Proxy at Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>`,
    to,
    replyTo: canReply ? replyTo : CHAT_FROM_ADDRESS,
    subject,
    html,
    text,
  });
}

/*
 * Tour scheduling emails (per-listing agents): request, proposal,
 * confirmation (with a calendar file), cancellation, reminders. One shape,
 * the caller supplies the words.
 */
// `sandbox` is true when the student or the landlord is a review sandbox account:
// sendMailSafe then records the email as suppressed and sends nothing.
// `audience` ("student" or "landlord") decides whether the links carry
// marketing tags (lib/marketing/emailLinks.js): only a student's do.
export async function sendTourEmail({ kind, to, name, subject, intro, lines = [], note = "", ctaLabel, ctaUrl, attachment = null, userId = null, replyTo = null, threadId = null, sandbox = false, audience = null }) {
  const first = name ? String(name).split(" ")[0] : "";
  await sendMailSafe(transporter, {
    logAs: { kind, userId, threadId, audience },
    sandbox,
    from: `"Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>`,
    to,
    // A reply goes into the direct chat when the email carries its reply address.
    replyTo: replyTo || CHAT_FROM_ADDRESS,
    subject,
    ...(attachment ? { attachments: [{ filename: attachment.filename, content: attachment.content, contentType: attachment.contentType }] } : {}),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111;font-size:14px">
        <p>${first ? `Hi ${escapeHtml(first)},` : "Hi,"}</p>
        <p>${escapeHtml(intro)}</p>
        ${lines.length ? `<ul style="margin:8px 0 12px 18px;padding:0">${lines.map((l) => `<li style="margin:3px 0">${escapeHtml(l)}</li>`).join("")}</ul>` : ""}
        ${note ? `<p style="color:#444">${escapeHtml(note)}</p>` : ""}
        ${ctaUrl ? `<a href="${ctaUrl}" style="display:inline-block;margin:12px 0;padding:11px 20px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">${escapeHtml(ctaLabel ?? "Open Proximity")}</a>` : ""}
        ${emailFooter({ reason: "You are receiving this because of a tour request on Proximity." })}
      </div>`,
  });
}

/*
 * A tour email to the landlord side, already built by lib/agents/tourEmails.js
 * in the inquiry layout. Same transport, logging and sandbox rule as
 * sendTourEmail; `fromName` is the student's name on a request.
 */
export async function sendLandlordTourEmail({ kind, to, fromName = "Proximity", subject, html, text, attachment = null, userId = null, replyTo = null, threadId = null, sandbox = false }) {
  await sendMailSafe(transporter, {
    // Always to a landlord, so its links never carry campaign tags.
    logAs: { kind, userId, threadId, audience: "landlord" },
    sandbox,
    from: { name: displayName(fromName, "Proximity"), address: process.env.EMAIL_USER || CHAT_FROM_ADDRESS },
    to,
    // A reply goes into the direct chat when the email carries its reply address.
    replyTo: replyTo || CHAT_FROM_ADDRESS,
    subject,
    ...(attachment ? { attachments: [{ filename: attachment.filename, content: attachment.content, contentType: attachment.contentType }] } : {}),
    html,
    text,
  });
}

/*
 * The per-listing agents' daily rollout digest, to the team: sections of
 * label and value rows, each with an optional list and note.
 */
export async function sendAgentDigestEmail({ to, day, sections, baseUrl }) {
  const block = (s) => `
    <h3 style="margin:18px 0 6px;color:#111;font-size:14px">${escapeHtml(s.title)}</h3>
    <table style="border-collapse:collapse;font-size:13px">${(s.rows ?? []).map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#444">${escapeHtml(String(k))}</td><td style="padding:2px 0;font-weight:600">${escapeHtml(String(v))}</td></tr>`).join("")}</table>
    ${s.note ? `<p style="margin:6px 0 2px;color:#666;font-size:12px">${escapeHtml(s.note)}</p>` : ""}
    ${(s.list ?? []).length ? `<ul style="margin:4px 0 0 18px;padding:0;font-size:12px;color:#333">${s.list.map((l) => `<li style="margin:2px 0">${escapeHtml(l)}</li>`).join("")}</ul>` : ""}`;
  await sendMailSafe(transporter, {
    logAs: { kind: "agent_digest" },
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Agents digest: ${day}`,
    html: `
      <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#111;font-size:14px">
        <h2 style="color:#111">Per-listing agents, ${escapeHtml(day)}</h2>
        ${(sections ?? []).map(block).join("")}
        <p style="margin-top:18px"><a href="${baseUrl}/dashboard/admin/agents" style="color:#dc2626">Open the admin Agents page</a></p>
        ${emailFooter({ reason: "You are receiving this because you administer the per-listing agents on Proximity." })}
      </div>`,
  });
}
