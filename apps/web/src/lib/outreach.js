/*
 * Outreach guard. External, user-visible side-effects (transactional email, Airtable sync)
 * must only reach real recipients on the production site — never on staging or local, where
 * the data is a prod snapshot containing real customer emails.
 *
 * sendMailSafe() wraps a Nodemailer transporter:
 *   - production: sends normally to the real recipient.
 *   - any non-production env (staging OR local): NEVER emails the real recipient. If a
 *     tester has chosen a destination via the email picker (the `staging_email_to` cookie
 *     on web, or an `x-staging-email-to` request header for clients that can't use cookies —
 *     namely the mobile app, see EXPO_PUBLIC_TEST_EMAIL_TO), every email is REDIRECTED to
 *     that inbox (cc/bcc dropped, original recipient noted in the subject) so flows can be
 *     tested end-to-end safely. Cron/webhook contexts have no request to read a cookie or
 *     header from, so OUTREACH_TEST_RECIPIENT (env var) is the fallback there. With no
 *     recipient chosen by any of the three, the email is suppressed (logged only). Pass the
 *     incoming `req` through when a caller has one, so the header/cookie checks can run.
 *
 * Use it everywhere instead of calling transporter.sendMail() directly. For non-email
 * outreach, gate the call site with outreachEnabled().
 */
import { outreachEnabled } from "./appEnv.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RECIPIENT_COOKIE = "staging_email_to";
const RECIPIENT_HEADER = "x-staging-email-to";

// Read the dev-chosen test recipient — from the request header first (mobile has no
// cookies to use), falling back to the browser cookie (web's picker widget). Returns null
// outside a request context (e.g. cron / webhooks), when unset, or when `req` is omitted.
async function stagingTestRecipient(req) {
  const headerValue = req?.headers?.get?.(RECIPIENT_HEADER);
  if (headerValue && EMAIL_RE.test(headerValue)) return headerValue;

  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const value = store.get(RECIPIENT_COOKIE)?.value;
    return value && EMAIL_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function sendMailSafe(transporter, message, req) {
  if (outreachEnabled()) {
    return transporter.sendMail(message);
  }

  // Non-production (staging or local): redirect to the tester-chosen inbox if set,
  // otherwise suppress. The real recipient is never contacted off production.
  // Cron/webhook contexts have no request (and mobile has no cookies), so
  // OUTREACH_TEST_RECIPIENT provides the same redirect for them — header/cookie
  // wins when present, env var is the fallback.
  const envRecipient = EMAIL_RE.test(process.env.OUTREACH_TEST_RECIPIENT ?? "")
    ? process.env.OUTREACH_TEST_RECIPIENT
    : null;
  const to = (await stagingTestRecipient(req)) ?? envRecipient;
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
