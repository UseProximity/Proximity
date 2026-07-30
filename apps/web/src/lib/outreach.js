/*
 * Outreach guard. External, user-visible side-effects (transactional email, Airtable sync)
 * must only reach real recipients on the production site — never on staging or local, where
 * the data is a prod snapshot containing real customer emails.
 *
 * sendMailSafe() wraps a Nodemailer transporter:
 *   - production: sends normally to the real recipient.
 *   - any non-production env (staging OR local): NEVER emails the real recipient. If a
 *     tester has chosen a destination via the email picker (the `staging_email_to` cookie),
 *     every email is REDIRECTED to that inbox (cc/bcc dropped, original recipient noted in
 *     the subject) so flows can be tested end-to-end safely. With no recipient chosen, the
 *     email is suppressed (logged only).
 *   - OUTREACH_ALLOWLIST escape hatch: addresses listed there may receive mail off
 *     production. Needed because the cookie picker only exists inside a request context —
 *     background work (the nightly PMS sync digest, webhooks) has no cookies and would
 *     otherwise be silently suppressed, leaving a pilot with no way to observe itself.
 *     Deliberately all-or-nothing per message: a message is only sent when EVERY one of
 *     its recipients is allowlisted, so a digest that happens to include a real landlord
 *     from the prod snapshot falls back to redirect/suppress rather than partially sending.
 *
 * Use it everywhere instead of calling transporter.sendMail() directly. For non-email
 * outreach, gate the call site with outreachEnabled().
 */
import { outreachEnabled } from "./appEnv.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RECIPIENT_COOKIE = "staging_email_to";

function allowlist() {
  return new Set(
    (process.env.OUTREACH_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

// Nodemailer accepts a string ("a@b, c@d"), an array, or {name, address} objects.
function recipientAddresses(value) {
  const flat = Array.isArray(value) ? value : [value];
  return flat
    .flatMap((entry) =>
      typeof entry === "string" ? entry.split(",") : [entry?.address ?? ""]
    )
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);
}

// True only when there is at least one recipient and every one of them is allowlisted.
function fullyAllowlisted(message) {
  const allowed = allowlist();
  if (!allowed.size) return false;
  const to = recipientAddresses(message?.to);
  if (!to.length) return false;
  const cc = [...recipientAddresses(message?.cc), ...recipientAddresses(message?.bcc)];
  return [...to, ...cc].every((addr) => allowed.has(addr));
}

// Read the dev-chosen test recipient from the request cookies. Returns null outside a
// request context (e.g. cron / webhooks) or when unset.
async function stagingTestRecipient() {
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const value = store.get(RECIPIENT_COOKIE)?.value;
    return value && EMAIL_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function sendMailSafe(transporter, message) {
  if (outreachEnabled()) {
    return transporter.sendMail(message);
  }

  // Every recipient is explicitly allowlisted for off-production mail (pilot
  // monitoring). Send as-is so the message is byte-identical to what production
  // would deliver — that is the point of watching it.
  if (fullyAllowlisted(message)) {
    console.log(`[outreach allowlisted] sending → to=${message?.to} subject=${message?.subject}`);
    return transporter.sendMail(message);
  }

  // Non-production (staging or local): redirect to the tester-chosen inbox if set,
  // otherwise suppress. The real recipient is never contacted off production.
  const to = await stagingTestRecipient();
  if (to) {
    const original = message?.to ?? "(none)";
    console.log(`[outreach non-prod] redirecting email (was ${original}) → ${to}`);
    // Collapse everything to the single test inbox — drop cc/bcc so a real (or
    // placeholder) carbon-copy recipient is never emailed off production.
    return transporter.sendMail({
      ...message,
      to,
      cc: undefined,
      bcc: undefined,
      subject: `[TEST → was: ${original}] ${message?.subject ?? ""}`,
    });
  }

  console.log(`[outreach suppressed] would send → to=${message?.to} subject=${message?.subject}`);
  return { suppressed: true };
}

export { outreachEnabled };
