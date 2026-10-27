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
import { sendMailSafe } from "./outreach";
import { stayOnProximityNote } from "./chat/moderation";
import { escapeHtml } from "./escapeHtml";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  // STARTTLS or nothing: never let a stripped EHLO send AUTH in cleartext.
  requireTLS: true,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

/*
 * Amazon SES, for chat alerts and alert-address confirmations. It can send as
 * info@useproximity.org with a reply+token Reply-To on our own reply domain,
 * which Gmail SMTP cannot, and it reports bounces and complaints back to
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

/*
 * The footer every outbound email carries.
 *
 * CAN-SPAM requires commercial email to give a valid physical postal address and
 * a working way to stop receiving it. Transactional mail (a password reset, a
 * verification link, an inquiry we are delivering on someone's behalf) is exempt
 * from the opt-out requirement, but carries the address anyway so that every
 * message we send says plainly who sent it.
 *
 * The opt-out is a reply rather than a one-click link, which the statute allows
 * as an internet-based mechanism. That makes it a promise about a mailbox rather
 * than about code: the commercial senders set replyTo to OPT_OUT_INBOX, and
 * whoever works that inbox has to action an unsubscribe within 10 business days
 * for this to stay true. Swapping in a real link later means a stored opt-out
 * list and a suppression check in sendMailSafe, not a change here.
 *
 * POSTAL_ADDRESS intentionally repeats what the legal documents say in
 * src/content/legal/. If the company address ever changes, both move together.
 */
const POSTAL_ADDRESS =
  "Proximity LLC, 117 South Lexington Street, Ste 100, Harrisonville, MO 64701";
const OPT_OUT_INBOX = "info@useproximity.org";

/*
 * `reason` is the one line telling someone why this landed in their inbox. On a
 * commercial send it is what identifies the message, so it is required there and
 * the call sites all pass one.
 */
export function emailFooter({ reason, commercial = false } = {}) {
  const optOut = commercial
    ? `<p style="color:#999;font-size:12px;line-height:1.5;margin:0 0 6px">
         Don&#39;t want these? Reply to this email with &quot;unsubscribe&quot; and we
         will stop sending them.
       </p>`
    : "";

  return `
      <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb">
        ${reason ? `<p style="color:#999;font-size:12px;line-height:1.5;margin:0 0 6px">${reason}</p>` : ""}
        ${optOut}
        <p style="color:#999;font-size:12px;line-height:1.5;margin:0">${POSTAL_ADDRESS}</p>
      </div>`;
}

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

// Inquiry sent on a student's behalf by the matchmaking chatbot ("Proxy"). Goes to the
// listing's owner with the student CC'd and set as reply-to, so the landlord replies
// straight to the student. Routed through sendMailSafe, so on staging it's redirected to
// the chosen test inbox (and the cc is dropped) — never reaching a real owner.
export async function sendOwnerInquiryEmail({ to, landlordName, student, listingAddress, message, req }) {
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
 * With a replyTo (the private reply+token address) the email says it can be
 * answered directly. Without one, or when it falls back to Gmail, it only
 * points to the app, since a reply would land in the shared inbox instead.
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
}) {
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
  const from = { name: fromName, address: CHAT_FROM_ADDRESS };

  let sesError = null;
  if (sesTransporter && replyTo) {
    try {
      const { html, text } = build(true);
      const info = await sendMailSafe(sesTransporter, {
        logAs: { kind: reminder ? "chat_reminder" : "chat_alert", threadId, userId: recipientId },
        from,
        to,
        replyTo,
        subject,
        headers,
        html,
        text,
        ses: SES_SEND_OPTIONS,
      }, testEmailTo);
      return { provider: "ses", messageId: info?.response || info?.messageId || null, suppressed: Boolean(info?.suppressed) };
    } catch (err) {
      console.error("sendChatMessageEmail: SES send failed, falling back to Gmail:", err);
      sesError = String(err?.message ?? err).slice(0, 300);
    }
  }

  const { html, text } = build(false);
  const info = await sendMailSafe(transporter, {
    logAs: { kind: reminder ? "chat_reminder" : "chat_alert", threadId, userId: recipientId },
    from: { name: fromName, address: process.env.EMAIL_USER || CHAT_FROM_ADDRESS },
    to,
    subject,
    headers,
    html,
    text,
  }, testEmailTo);
  return { provider: "gmail", messageId: info?.messageId || null, suppressed: Boolean(info?.suppressed), sesError };
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
  attachments_removed:
    "The attached file could not be posted. Files that share contact details or ask for payment are not allowed in Proximity conversations.",
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

// What an emailed reply contained, in words the sender recognises. Keyed by
// the reasons from lib/chat/moderation.js.
const GUIDELINE_REASONS = {
  contact_email: "an email address",
  contact_phone: "a phone number",
  external_link: "a link to an outside website",
  social_handle: "a social media handle",
  off_platform_request: "a request to continue outside Proximity",
  irreversible_payment_rail: "a request for payment through gift cards, wire or cryptocurrency",
  off_platform_payment_request: "a request for payment through an app Proximity cannot protect",
  credential_phishing: "a request for login details",
  slur: "abusive language",
  threat: "a threat",
};

function listReasons(reasons) {
  const parts = [...new Set(reasons.map((r) => GUIDELINE_REASONS[r]).filter(Boolean))];
  if (parts.length === 0) return "contact details";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/*
 * Sent right after an emailed reply that broke the conversation rules was
 * posted (Wyatt, 2026-10-12): by email the message is delivered and flagged,
 * not blocked, and the sender is told what it contained and why to keep the
 * conversation on Proximity. `removed` is true when part of the message was
 * cut (abuse, fraud or phishing) rather than delivered in full. Marked
 * Auto-Submitted so an out-of-office does not answer it.
 */
export function buildReplyGuidelinesEmail({ otherFirst, reasons, removed, baseUrl, audience = "student" }) {
  const who = displayName(otherFirst, "the other person");
  const what = listReasons(reasons);
  const inboxUrl = `${baseUrl}/messages`;
  const future = "In the future, please refrain from taking conversations outside of Proximity, unless it is to finalize a deal.";
  const delivered = removed
    ? `Your reply to ${who} was delivered, but part of it was removed because it contained ${what}. ${future}`
    : `Your reply to ${who} was delivered. It contained ${what}, which Proximity conversations are meant to keep out. ${future}`;
  const why = stayOnProximityNote(audience, "email");
  const how = `Please reply to the message emails from Proximity the way you would reply to ${who} directly, and your words land in the conversation. Replies that keep including contact details may stop being delivered.`;
  return {
    subject: "A note about your reply",
    text: `${delivered}\n\n${why}\n\n${how}\n\nThe conversation on Proximity:\n${inboxUrl}\n\n${POSTAL_ADDRESS}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px 20px;color:#111827;font-size:15px;line-height:1.6">
        <p style="margin:0 0 14px">${escapeHtml(delivered)}</p>
        <p style="margin:0 0 14px">${escapeHtml(why)}</p>
        <p style="margin:0 0 14px">${escapeHtml(how)}</p>
        <p style="margin:0 0 14px"><a href="${inboxUrl}" style="color:#6b7280">The conversation on Proximity</a></p>
        <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.5">
          <p style="margin:0 0 6px">You are receiving this because you replied to a Proximity message alert.</p>
          <p style="margin:0">${POSTAL_ADDRESS}</p>
        </div>
      </div>
    `,
  };
}

export async function sendReplyGuidelinesEmail({ to, otherFirst, reasons, removed, baseUrl, audience = "student" }) {
  const built = buildReplyGuidelinesEmail({ otherFirst, reasons, removed, baseUrl, audience });
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
      await sendMailSafe(sesTransporter, { logAs: { kind: "reply_guidelines" }, ...message, ses: SES_SEND_OPTIONS });
      return;
    } catch (err) {
      console.error("sendReplyGuidelinesEmail: SES send failed, falling back to Gmail:", err);
    }
  }
  await sendMailSafe(transporter, { logAs: { kind: "reply_guidelines" }, ...message, from: `"Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>` });
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
  const verifyUrl =
    `${baseUrl}/api/auth/verify-email?token=${token}` +
    (next ? `&next=${encodeURIComponent(next)}` : "");
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
export async function sendReviewConfirmationEmail({ email, name, baseUrl, places, setupToken }) {
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

  const ctaUrl = setupToken ? `${baseUrl}/review/finish?token=${setupToken}` : `${baseUrl}/matchmaking`;
  const ctaLabel = setupToken ? "Finish my profile" : "Matchmaking";

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
const escSync = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function describeChange(c) {
  const where = c.detail?.label ? `${escSync(c.detail.label)}: ` : "";
  const money = (n) => (n == null ? "no price" : `$${Number(n).toLocaleString("en-US")}`);
  switch (c.kind) {
    case "lease_new":
      return `${where}new lease at ${money(c.new?.rent)}${c.new?.rentIsPerPerson ? " per person" : ""}${(c.new?.leaseTermMonths ?? []).length ? ` (${c.new.leaseTermMonths.join(", ")} months)` : ""}`;
    case "lease_withdrawn":
      return `${where}lease at ${money(c.detail?.rent)} no longer offered, marked unavailable`;
    case "lease_updated":
      return `${where}lease details updated (${escSync(c.field)})`;
    case "unit_relisted":
      return `${where}lease is back on the website`;
    case "unit_new":
      return `${where}new floor plan on the website${c.new?.offers ? `, ${c.new.offers} price${c.new.offers === 1 ? "" : "s"}` : ""}`;
    case "unit_updated":
      return `${where}unit details filled in (${escSync(c.field)})`;
    case "spec_mismatch":
      return `${where}bed/bath/size differ from the website (${escSync(JSON.stringify(c.old))} vs ${escSync(JSON.stringify(c.new))})`;
    case "missing_unit":
      return `${where}no longer on the website`;
    case "property_updated":
      return `property details filled in`;
    case "photos_added":
      return `${where}${c.new} photo${c.new === 1 ? "" : "s"} added`;
    default:
      return `${where}${escSync(c.kind)}`;
  }
}

export async function sendSourceSyncDigestEmail({ to, items, baseUrl }) {
  const block = (i) => {
    const link = `${baseUrl}/dashboard/admin?listing=${encodeURIComponent(i.listingId)}`;
    const head = `<p style="margin:16px 0 4px"><strong>${escSync(i.listing)}</strong> <span style="color:#666">(${escSync(i.status)}${i.platform ? `, ${escSync(i.platform)}` : ""}${i.confidence ? `, ${escSync(i.confidence)} confidence` : ""})</span><br><a href="${link}" style="color:#dc2626;font-size:12px">open in admin</a></p>`;
    if (i.status === "failed") return `${head}<p style="color:#b91c1c;margin:0">Failed: ${escSync(i.error)}</p>`;
    const applied = (i.applied ?? []).map((c) => `<li>${describeChange(c)}</li>`).join("");
    const held = (i.held ?? []).map((c) => `<li>${describeChange(c)}${c.detail?.judge?.reason ? ` <span style="color:#666">(${escSync(c.detail.judge.reason)})</span>` : ""}</li>`).join("");
    const hold = i.holdReason
      ? `<p style="color:#b45309;margin:4px 0">Held for review: ${i.holdReason === "churn_hold" ? "more than a fifth of the leases would change at once" : "the reader was not confident in this read"}. Nothing was applied.</p>`
      : "";
    return `${head}${hold}${applied ? `<p style="margin:4px 0 2px;color:#166534">Applied</p><ul style="margin:0 0 6px 18px;padding:0">${applied}</ul>` : ""}${held ? `<p style="margin:4px 0 2px;color:#b45309">Needs a look</p><ul style="margin:0 0 6px 18px;padding:0">${held}</ul>` : ""}`;
  };
  const changed = items.filter((i) => i.status !== "unchanged" && i.status !== "ok");
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
        <p style="color:#666;font-size:12px;margin-top:16px">Every change above is in listing_source_events. Held changes can be applied from the import review or the admin console.</p>
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
        <p><strong>${escSync(listing)}</strong> could not be read from <a href="${escSync(sourceUrl)}">${escSync(sourceUrl)}</a>.</p>
        <p style="color:#b91c1c">${escSync(error)}</p>
        <p style="color:#444">Failure ${failures} in a row. The listing was left as it was; the next check is pushed back accordingly.</p>
        <p><a href="${baseUrl}/dashboard/admin?listing=${encodeURIComponent(listingId)}" style="color:#dc2626">Open in admin</a></p>
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
        <p>The site-wide cap on ${escSync(kind)} reads was reached: ${Number(used)} of ${Number(limit)} in the last ${Number(hours)} hours.</p>
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
export async function sendProxyStudentEmail({ to, name, kind, listingLabel, messages, threadUrl, threadId = null, userId = null }) {
  const first = name ? String(name).split(" ")[0] : "";
  const subject = kind === "proxy_relay"
    ? `The landlord answered your question about ${listingLabel}`
    : kind === "proxy_no_answer"
      ? `No answer yet about ${listingLabel}`
      : `Proxy answered your question about ${listingLabel}`;
  await sendMailSafe(transporter, {
    logAs: { kind, threadId, userId },
    from: `"Proxy at Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>`,
    to,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111;font-size:14px">
        <p>${first ? `Hi ${escapeHtml(first)},` : "Hi,"}</p>
        <p>${kind === "proxy_relay" ? "The landlord's answer came back." : kind === "proxy_no_answer" ? "An update on your question." : "Here is what Proxy found."} About <strong>${escapeHtml(listingLabel)}</strong>:</p>
        ${proxyParagraphs(messages)}
        <a href="${threadUrl}" style="display:inline-block;margin:16px 0;padding:11px 20px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Open the conversation</a>
        <p style="color:#666;font-size:12px">Proxy is an automated assistant. Its answers are compiled from several sources and may be inaccurate or out of date; confirm anything important with the landlord before signing.</p>
        ${emailFooter({ reason: "You are receiving this because you asked Proxy about a listing on Proximity." })}
      </div>`,
  });
}

/*
 * To a landlord: a student's question Proxy could not answer (or a reminder,
 * or the student's reply to a clarifying question). The student is never
 * named; the context line says which lease and whether they were signed in.
 * A contact with no account yet is asked to create one to answer.
 */
export async function sendProxyLandlordQuestionEmail({
  to, name, listingLabel, question, context, queueUrl, kind = "proxy_question",
  hasAccount = true, studentReply = null, reminderDay = null, replyTo = null,
}) {
  const first = name ? String(name).split(" ")[0] : "";
  // With a per-question reply address, answering the email answers the student.
  const canReply = !!replyTo && hasAccount;
  const subject = reminderDay
    ? `Reminder: a student is waiting on an answer about ${listingLabel}`
    : studentReply
      ? `The student replied about ${listingLabel}`
      : `A student has a question about ${listingLabel}`;
  const intro = reminderDay
    ? `A student asked this ${reminderDay === 1 ? "yesterday" : `${reminderDay} days ago`} and is still waiting. Proxy will tell them there is no answer after five days.`
    : studentReply
      ? "The student answered your question:"
      : "Proxy, the assistant on your listing, could not answer this from what it knows, so it is passing it to you. Your answer goes back to the student through Proxy and is saved so you are not asked again.";
  await sendMailSafe(transporter, {
    logAs: { kind },
    from: `"Proxy at Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>`,
    to,
    replyTo: canReply ? replyTo : CHAT_FROM_ADDRESS,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111;font-size:14px">
        <p>${first ? `Hi ${escapeHtml(first)},` : "Hi,"}</p>
        <p>${escapeHtml(intro)}</p>
        <p style="color:#666;font-size:12px;margin:0">${escapeHtml(context ?? "")}</p>
        ${proxyParagraphs([question])}
        ${studentReply ? `<p style="color:#666;font-size:12px;margin:12px 0 0">Their reply:</p>${proxyParagraphs([studentReply])}` : ""}
        ${canReply ? `<p><strong>Reply to this email to answer.</strong> Attach a flyer or fee sheet if that is easier; Proxy reads it.</p>` : ""}
        <a href="${queueUrl}" style="display:inline-block;margin:16px 0;padding:11px 20px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">${hasAccount ? "Answer in your dashboard" : "Create an account to answer"}</a>
        ${hasAccount ? "" : `<p style="color:#666;font-size:12px">This address is listed as the contact for ${escapeHtml(listingLabel)} on Proximity. Sign up with it to see and answer questions from students.</p>`}
        <p style="color:#666;font-size:12px">Phone numbers, emails and links in an answer are removed before it reaches a student. Contact details are shared when a student books a tour.</p>
        ${emailFooter({ reason: "You are receiving this because you are the contact for a listing on Proximity." })}
      </div>`,
  });
}

/*
 * Tour scheduling emails (per-listing agents): request, proposal,
 * confirmation (with a calendar file), cancellation, reminders. One shape,
 * the caller supplies the words.
 */
export async function sendTourEmail({ kind, to, name, subject, intro, lines = [], note = "", ctaLabel, ctaUrl, attachment = null, userId = null }) {
  const first = name ? String(name).split(" ")[0] : "";
  await sendMailSafe(transporter, {
    logAs: { kind, userId },
    from: `"Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>`,
    to,
    replyTo: CHAT_FROM_ADDRESS,
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
