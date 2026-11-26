/*
 * The record of every email the app sends, for the admin "Sent emails" page
 * (Wyatt, 2026-10-24). sendMailSafe (lib/outreach.js) calls recordEmail once
 * per attempt, so an email type added later is logged without anyone
 * remembering to. Callers label their email with `logAs: { kind }` on the
 * message; an unlabelled one is still logged, as "Other".
 *
 * Bodies are stored with every token in their links replaced by [removed]
 * (redactSecrets), because a password-reset, setup, invite or chat link is a
 * working login for whoever holds it, and this table is read by the admin
 * panel. SES delivery events update the row later (/api/ses/events).
 *
 * Logging never blocks or breaks a send: every failure here is caught and
 * written to the server log instead.
 *
 * The pure helpers import nothing from the app, so the node test runner can
 * load them; the database client is imported only when a row is written.
 */

import { categoryOf } from "./emailKinds.js";

// A link's secret travels as one of these query parameters (raw, after "&amp;"
// in HTML, or percent-encoded inside another link's callbackUrl), or as the
// path segment of a review invite link.
const SECRET_PARAM =
  /((?:[?&;]|%3F|%26)(?:token|access_token|id_token|code|key|sig|signature|secret)(?:=|%3D))[^&#"'\s<>]+/gi;
const SECRET_PATH = /(\/review-invite\/t\/)[^/?#"'\s<>]+/gi;
// Belt and braces for a token under a name not listed above: any long opaque
// query value that is not a plain UUID (thread and listing ids stay readable).
const LONG_VALUE =
  /((?:[?&;]|%3F|%26)[a-z_]+(?:=|%3D))(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![A-Za-z0-9_~-]))[A-Za-z0-9_\-.~%]{32,}/gi;

export function redactSecrets(value) {
  if (typeof value !== "string" || !value) return null;
  return value
    .replace(SECRET_PARAM, "$1[removed]")
    .replace(SECRET_PATH, "$1[removed]")
    .replace(LONG_VALUE, "$1[removed]");
}

function addressList(value) {
  if (!value) return null;
  const list = (Array.isArray(value) ? value : [value])
    .map((v) => (typeof v === "string" ? v : v?.address ?? ""))
    .filter(Boolean);
  return list.length ? list.join(", ") : null;
}

const cap = (s, n) => (typeof s === "string" && s.length > n ? s.slice(0, n) : s ?? null);

/**
 * Pure: the row for one attempt.
 * @param {object} mail      the nodemailer message as the caller built it
 * @param {object} logAs     { kind, threadId, userId } from the caller
 * @param {object} outcome   { provider, providerMessageId, status, detail, redirectedTo }
 */
export function buildEmailRow(mail, logAs, outcome) {
  const kind = logAs?.kind ?? "other";
  return {
    category: categoryOf(kind),
    kind,
    to_email: cap(addressList(mail?.to), 1000),
    cc: cap(addressList([...[].concat(mail?.cc ?? []), ...[].concat(mail?.bcc ?? [])]), 1000),
    redirected_to: outcome.redirectedTo ?? null,
    from_email: cap(addressList(mail?.from), 300),
    subject: cap(mail?.subject, 1000),
    body_html: cap(redactSecrets(mail?.html), 500000),
    body_text: cap(redactSecrets(mail?.text), 200000),
    provider: outcome.provider ?? null,
    provider_message_id: outcome.providerMessageId ?? null,
    status: outcome.status,
    status_detail: cap(outcome.detail, 500),
    status_at: new Date().toISOString(),
    thread_id: logAs?.threadId ?? null,
    user_id: logAs?.userId ?? null,
  };
}

export async function recordEmail(mail, logAs, outcome) {
  if (process.env.EMAIL_LOG_DISABLED === "1") return;
  try {
    const { default: supabase } = await import("./supabase.js");
    const { error } = await supabase.from("sent_emails").insert(buildEmailRow(mail, logAs, outcome));
    if (error) console.error("sent email log: insert failed:", error.message);
  } catch (err) {
    console.error("sent email log failed:", err?.message ?? err);
  }
}
