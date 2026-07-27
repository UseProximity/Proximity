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
import { sendMailSafe } from "./outreach";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

export function getBaseUrl(req) {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("host");
  return `${proto}://${host}`;
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
      </div>
    `,
  });
}

export async function sendVerificationEmail({ email, name, token, baseUrl }) {
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;
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
      </div>
    `,
  });
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
      </div>
    `,
  });
}
