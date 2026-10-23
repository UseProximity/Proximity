/*
 * Outreach guard. External, user-visible side-effects (transactional email, Airtable sync)
 * must only reach real recipients on the production site — never on staging or local, where
 * the data is a prod snapshot containing real customer emails.
 *
 * sendMailSafe() wraps a Nodemailer transporter:
 *   - production: sends normally to the real recipient.
 *   - any non-production env (staging OR local): NEVER emails the real recipient. If a
 *     tester has chosen a destination via the email picker (the `staging_email_to` cookie
 *     on web, or an `x-staging-email-to` request header for clients that can't use cookies,
 *     namely the mobile app; see EXPO_PUBLIC_TEST_EMAIL_TO), every email is REDIRECTED to
 *     that inbox (cc/bcc dropped, original recipient noted in the subject) so flows can be
 *     tested end-to-end safely. Cron/webhook contexts have no request to read a cookie or
 *     header from, so OUTREACH_TEST_RECIPIENT (env var) is the fallback there. With no
 *     recipient chosen by any of the three, the email is suppressed (logged only). Pass the
 *     incoming `req` through when a caller has one, so the header/cookie checks can run
 *     (or, from inside after(), the header value captured earlier with stagingEmailHeader).
 *
 * The cookie and header are set by the client, so anyone visiting a staging or preview
 * deployment can set them. A redirect target they name is only honoured when it is on
 * STAGING_EMAIL_ALLOWLIST (server env, comma-separated addresses or "@domain" entries;
 * defaults to the team's own domain). Otherwise a stranger could point the cookie at
 * their own inbox, request a password reset for any account in the prod-data snapshot,
 * and receive the link.
 *
 * Use it everywhere instead of calling transporter.sendMail() directly. For non-email
 * outreach, gate the call site with outreachEnabled().
 */
import { outreachEnabled } from "./appEnv.js";

// One ordinary address only: commas, semicolons and angle brackets are rejected so a
// header, cookie or env value cannot name several recipients (nodemailer splits on them).
// Keep identical to the copies in StagingEmailPicker.js and mobile stagingEmail.js
// (outreach.test.mjs checks they match).
const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
const RECIPIENT_COOKIE = "staging_email_to";
const RECIPIENT_HEADER = "x-staging-email-to";
const DEFAULT_ALLOWLIST = "@useproximity.org";

// Whether a client-chosen redirect target is one the server has approved.
function allowedTestRecipient(address) {
  const entries = (process.env.STAGING_EMAIL_ALLOWLIST || DEFAULT_ALLOWLIST)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const addr = address.toLowerCase();
  return entries.some((e) => (e.startsWith("@") ? addr.endsWith(e) : addr === e));
}
const usableTestRecipient = (value) =>
  !!value && EMAIL_RE.test(value) && allowedTestRecipient(value);

// The raw test-recipient header from a request, or null. Routes that send inside
// after() read it here BEFORE scheduling the callback and pass the plain string on
// (sendMailSafe accepts it in place of `req`), so nothing relies on the request
// object still being usable once the response has gone out.
export function stagingEmailHeader(req) {
  return req?.headers?.get?.(RECIPIENT_HEADER) ?? null;
}

// Read the dev-chosen test recipient: from the request header first (mobile has no
// cookies to use), falling back to the browser cookie (web's picker widget). Returns null
// outside a request context (e.g. cron / webhooks), when unset, or when `req` is omitted.
async function stagingTestRecipient(req) {
  const headerValue = typeof req === "string" ? req : stagingEmailHeader(req);
  if (usableTestRecipient(headerValue)) return headerValue;

  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const value = store.get(RECIPIENT_COOKIE)?.value;
    return usableTestRecipient(value) ? value : null;
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
  // OUTREACH_TEST_RECIPIENT provides the same redirect for them: header/cookie
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
