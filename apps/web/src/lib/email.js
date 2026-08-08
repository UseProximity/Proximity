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

/*
 * One email per phase of a landlord's PMS onboarding (connect/discover, then
 * confirm), plus an immediate one when a phase fails. This is the pilot's only
 * window into an attempt that happens while nobody is watching, so it reports
 * the whole run: every step in order, and every place the PMS data did not fit
 * our tables.
 *
 * `steps` are ours and rendered as-is. Everything drawn from PMS data —
 * property names, raw field values, error text from the provider — is escaped.
 */
export async function sendPmsOnboardingReportEmail({
  to,
  provider,
  landlord,
  accountLabel,
  phase,
  failed,
  steps = [],
  findings = [],
  counts = null,
  landlordVisible = [],
  baseUrl,
  previewOnly = false,
}) {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const stepRows = steps
    .map((s) => {
      const mark = s.ok === false ? "✕" : "✓";
      const color = s.ok === false ? "#E82027" : "#15803d";
      return `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${color};font-weight:700;width:24px">${mark}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(s.step)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(s.message) || ""}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;white-space:nowrap">${s.durationMs}ms</td>
        </tr>`;
    })
    .join("");

  const severityColor = { blocker: "#E82027", gap: "#b45309", note: "#666" };
  const findingRows = findings
    .map(
      (f) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${severityColor[f.severity] ?? "#666"};font-weight:600;text-transform:uppercase;font-size:11px">${esc(f.severity)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(f.field) || esc(f.code)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">
            ${esc(f.message)}
            ${
              f.expected || f.received
                ? `<div style="color:#666;font-size:12px;margin-top:3px">expected <code>${esc(f.expected) || "—"}</code>, received <code>${esc(f.received) || "(empty)"}</code></div>`
                : ""
            }
            <div style="color:#888;font-size:12px;margin-top:3px">${f.count}× &middot; e.g. ${esc(f.examples?.join("; "))}</div>
          </td>
        </tr>`
    )
    .join("");

  const headline = failed
    ? "This attempt did not complete."
    : counts?.blockers
    ? `Connected and read the account, but ${counts.blockers} thing${counts.blockers === 1 ? "" : "s"} would not fit our schema.`
    : "Connected and read the account cleanly. Nothing needs attention.";

  await sendMailSafe(transporter, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to,
    subject: failed
      ? `PMS ${phase} FAILED — ${provider}${landlord ? ` (${landlord})` : ""}`
      : `PMS ${phase} — ${provider}${landlord ? ` (${landlord})` : ""}${counts?.blockers ? `: ${counts.blockers} schema blocker${counts.blockers === 1 ? "" : "s"}` : ": clean"}`,
    html: `
      <div style="font-family:sans-serif;max-width:680px;margin:0 auto;color:#111">
        <h2 style="color:#111;margin-bottom:4px">PMS onboarding: ${esc(phase)}</h2>
        <p style="color:#444;margin-top:0">${esc(headline)}</p>
        <table style="border-collapse:collapse;font-size:14px;margin-bottom:20px">
          <tr><td style="padding:2px 12px 2px 0;color:#666">System</td><td style="text-transform:capitalize">${esc(provider)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#666">Landlord</td><td>${esc(landlord) || "—"}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#666">Account</td><td>${esc(accountLabel) || "—"}</td></tr>
          ${previewOnly ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Mode</td><td>Preview only — nothing was written to listings</td></tr>` : ""}
        </table>

        <h3 style="font-size:15px;margin-bottom:6px">What happened, in order</h3>
        <table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:20px">
          ${stepRows || `<tr><td style="padding:6px 10px;color:#666">No steps recorded.</td></tr>`}
        </table>

        ${
          counts
            ? `<h3 style="font-size:15px;margin-bottom:6px">What came back</h3>
               <p style="font-size:14px;color:#444;margin-top:0">
                 ${counts.properties} propert${counts.properties === 1 ? "y" : "ies"},
                 ${counts.units} unit${counts.units === 1 ? "" : "s"}.
                 <strong>${counts.ingestable}</strong> of ${counts.properties} would import cleanly.
               </p>`
            : ""
        }

        <h3 style="font-size:15px;margin-bottom:6px">Schema alignment</h3>
        ${
          findingRows
            ? `<table style="border-collapse:collapse;width:100%;font-size:14px">
                 <tr>
                   <th align="left" style="padding:6px 10px;border-bottom:2px solid #111">Severity</th>
                   <th align="left" style="padding:6px 10px;border-bottom:2px solid #111">Field</th>
                   <th align="left" style="padding:6px 10px;border-bottom:2px solid #111">Problem</th>
                 </tr>
                 ${findingRows}
               </table>
               <p style="color:#666;font-size:12px;margin-top:8px">
                 blocker = would fail or write something false &middot;
                 gap = imports, but missing something students search on &middot;
                 note = informational
               </p>`
            : `<p style="font-size:14px;color:#15803d;margin-top:0">Everything mapped. No misalignment found.</p>`
        }

        ${
          landlordVisible.length
            ? `<h3 style="font-size:15px;margin-bottom:6px">What the landlord was shown</h3>
               <ul style="font-size:14px;color:#444;margin-top:0">${landlordVisible.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
            : ""
        }

        <p style="color:#666;font-size:13px;margin-top:20px">
          Every step above is also in pms_sync_events${baseUrl ? ` (${esc(baseUrl)})` : ""}.
        </p>
      </div>
    `,
  });
}

// One email per PMS sync run, only when a human should look: errored or
// guard-held connections, suppressed delists, and dry-run connections with
// intended changes waiting for review. Sent to PMS_ALERT_EMAIL or all supers.
// allClear = every item is a routine "nothing happened" report (PMS_DIGEST_ALWAYS
// during a pilot). Those must not arrive under a subject claiming attention is
// needed, or the alerting is trained to be ignored before it ever means anything.
export async function sendPmsSyncDigestEmail({ to, items, baseUrl, allClear = false }) {
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
    subject: allClear
      ? `PMS sync: all clear (${items.length} connection${items.length === 1 ? "" : "s"})`
      : `PMS sync: ${items.length} connection${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} a look`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111">
        <h2 style="color:#111">PMS sync digest</h2>
        <p style="color:#444">${
          allClear
            ? "Today's sync ran and had nothing to report. Listed for confirmation that it ran at all."
            : `Today's sync flagged the following. Nothing here was applied
           without its safety checks; anything held is waiting on you.`
        }</p>
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
