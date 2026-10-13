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

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
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

export async function sendPasswordResetEmail({ email, name, token, baseUrl }) {
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;
  await sendMailSafe(transporter, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Reset your Proximity password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Reset your password${name ? `, ${name}` : ""}</h2>
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
  });
}

export async function sendLandlordNudgeEmail({ email, name }) {
  const firstName = name ? name.split(" ")[0] : "";
  await sendMailSafe(transporter, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: email,
    replyTo: "info@useproximity.org",
    subject: "Having trouble getting your listing up?",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        <h2 style="color:#111">Welcome to Proximity${firstName ? `, ${firstName}` : ""}!</h2>
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
export async function sendOwnerInquiryEmail({ to, landlordName, student, listingAddress, message }) {
  // The contact flow always supplies the student's note (the editable draft can't be
  // sent empty), so use it directly. The short guard only avoids a blank quote if a
  // future caller omits it — the real default lives in contactNote.js.
  const note = (message && message.trim()) || "I'm a WashU student interested in this listing and would love to learn more.";
  return sendMailSafe(transporter, {
    from: `"Proximity" <${process.env.EMAIL_USER || "info@useproximity.org"}>`,
    to,
    cc: student.email || undefined,
    replyTo: student.email || undefined,
    subject: `New Inquiry: ${listingAddress || "Your Listing"} (via Proximity)`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
        <p>Hi ${landlordName || "there"},</p>
        <p>You've received a new inquiry${listingAddress ? ` about your listing at <strong>${listingAddress}</strong>` : ""} through Proximity.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="margin: 6px 0;"><strong>From:</strong> ${student.name}</p>
        <p style="margin: 6px 0;"><strong>Email:</strong> <a href="mailto:${student.email}" style="color: #dc2626;">${student.email}</a></p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="white-space: pre-wrap; color: #374151; font-style: italic;">"${note}"</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p>Reply directly to this email to respond to ${student.name}. Quick responses help students make confident decisions, and responsive landlords tend to get the best tenants.</p>
        <p>Best,<br/>The Proximity Team<br/><a href="https://useproximity.org" style="color: #dc2626;">useproximity.org</a></p>
        ${emailFooter({
          reason: "You are receiving this because a student sent an inquiry about a property listed on Proximity as yours.",
        })}
      </div>
    `,
  });
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

  const small = (line) => `<p style="margin:0 0 6px">${line}</p>`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px 20px;color:#111827;font-size:15px;line-height:1.6">
      ${canReply ? `<p style="color:#c4c8cf;font-size:11px;margin:0 0 20px">Reply above this line to message ${escapeHtml(other)}.</p>` : ""}
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

  if (sesTransporter && replyTo) {
    try {
      const { html, text } = build(true);
      const info = await sendMailSafe(sesTransporter, {
        from,
        to,
        replyTo,
        subject,
        headers,
        html,
        text,
        ses: SES_SEND_OPTIONS,
      });
      return { provider: "ses", messageId: info?.response || info?.messageId || null, suppressed: Boolean(info?.suppressed) };
    } catch (err) {
      console.error("sendChatMessageEmail: SES send failed, falling back to Gmail:", err);
    }
  }

  const { html, text } = build(false);
  const info = await sendMailSafe(transporter, {
    from: { name: fromName, address: process.env.EMAIL_USER || CHAT_FROM_ADDRESS },
    to,
    subject,
    headers,
    html,
    text,
  });
  return { provider: "gmail", messageId: info?.messageId || null, suppressed: Boolean(info?.suppressed) };
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
};

/*
 * Sent when an emailed reply could not be posted (lib/chat/inboundEmail.js), at
 * most once per sender per conversation per day. Marked Auto-Submitted so the
 * other side's out-of-office does not answer it and start a loop.
 */
export async function sendReplyNotDeliveredEmail({ to, reason, baseUrl }) {
  const why = NOT_DELIVERED_REASONS[reason] || NOT_DELIVERED_REASONS.rejected;
  const inboxUrl = `${baseUrl}/messages`;
  const message = {
    from: `"Proximity" <${CHAT_FROM_ADDRESS}>`,
    to,
    subject: "Your reply was not delivered",
    headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" },
    text: `Your reply was not delivered.\n\n${why}\n\nYou can always reply in the Proximity app:\n${inboxUrl}\n\n${POSTAL_ADDRESS}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111">
        <h2 style="color:#111">Your reply was not delivered</h2>
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
      await sendMailSafe(sesTransporter, { ...message, ses: SES_SEND_OPTIONS });
      return;
    } catch (err) {
      console.error("sendReplyNotDeliveredEmail: SES send failed, falling back to Gmail:", err);
    }
  }
  await sendMailSafe(transporter, { ...message, from: `"Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>` });
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
      await sendMailSafe(sesTransporter, { ...message, ses: SES_SEND_OPTIONS });
      return;
    } catch (err) {
      console.error("sendReplyGuidelinesEmail: SES send failed, falling back to Gmail:", err);
    }
  }
  await sendMailSafe(transporter, { ...message, from: `"Proximity" <${process.env.EMAIL_USER || CHAT_FROM_ADDRESS}>` });
}

// `next` is where to send them once verified, so someone who signed up in the
// middle of something (publishing a listing) lands back in it. The verify route
// sanitizes it again, so the link is not trusted just because we built it.
export async function sendVerificationEmail({ email, name, token, baseUrl, next }) {
  const verifyUrl =
    `${baseUrl}/api/auth/verify-email?token=${token}` +
    (next ? `&next=${encodeURIComponent(next)}` : "");
  await sendMailSafe(transporter, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Verify your Proximity account",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Welcome to Proximity${name ? `, ${name}` : ""}!</h2>
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
  });
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
export async function sendContactVerificationEmail({ to, landlordName, listingLabel, confirmUrl }) {
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
        <p>Once you confirm, each new message arrives here as an email. You can reply in the Proximity app or directly to the email. Either way, the conversation stays in ${landlord}&#39;s Proximity inbox.</p>
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
      await sendMailSafe(sesTransporter, { ...message, from: `"Proximity" <${CHAT_FROM_ADDRESS}>`, ses: SES_SEND_OPTIONS });
      return;
    } catch (err) {
      console.error("sendContactVerificationEmail: SES send failed, falling back to Gmail:", err);
    }
  }
  await sendMailSafe(transporter, message);
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

// Any value a user typed gets escaped before it is interpolated into an email body.
// Chat matters most: a message is typed by one user and rendered in another user's
// inbox, so escaping is what stops a body from smuggling markup into that inbox.
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

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
