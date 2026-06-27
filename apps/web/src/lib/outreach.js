/*
 * Outreach guard. External, user-visible side-effects (transactional email, Airtable sync)
 * must only reach real recipients on the production site — never on staging or local, where
 * the data is a prod snapshot containing real customer emails.
 *
 * sendMailSafe() wraps a Nodemailer transporter:
 *   - production: sends normally.
 *   - staging: if a developer has chosen a test recipient (the staging email picker sets the
 *     `staging_email_to` cookie), the email is REDIRECTED to that inbox with the original
 *     recipient noted in the subject — so flows can be tested end-to-end safely. If no
 *     recipient is chosen, the email is suppressed.
 *   - local / no recipient: suppressed (logged only).
 *
 * Use it everywhere instead of calling transporter.sendMail() directly. For non-email
 * outreach, gate the call site with outreachEnabled().
 */
import { outreachEnabled, isStaging } from "./appEnv";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RECIPIENT_COOKIE = "staging_email_to";

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

  if (isStaging()) {
    const to = await stagingTestRecipient();
    if (to) {
      const original = message?.to ?? "(none)";
      console.log(`[outreach staging] redirecting email (was ${original}) → ${to}`);
      return transporter.sendMail({
        ...message,
        to,
        subject: `[STAGING → was: ${original}] ${message?.subject ?? ""}`,
      });
    }
  }

  console.log(`[outreach suppressed] would send → to=${message?.to} subject=${message?.subject}`);
  return { suppressed: true };
}

export { outreachEnabled };
