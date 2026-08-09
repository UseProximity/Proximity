/*
 * Outreach guard. External, user-visible side-effects (transactional email, Airtable sync)
 * must only reach real recipients on the production site — never on staging or local, where
 * the data is a prod snapshot containing real customer emails.
 *
 * sendMailSafe() wraps a Nodemailer transporter:
 *   - production: sends normally to the real recipient.
 *   - PILOT deployments: EVERY message goes to PILOT_INBOX and nowhere else, checked
 *     ahead of every other rule. A pilot has a real landlord on the other side and no
 *     tester at a browser, so the cookie picker is hidden from them and suppression
 *     would mean their emails vanish. cc/bcc are dropped on the way through.
 *   - any non-production env (staging OR local): NEVER emails the real recipient. If a
 *     tester has chosen a destination via the email picker (the `staging_email_to` cookie),
 *     every email is REDIRECTED to that inbox (cc/bcc dropped, original recipient noted in
 *     the subject) so flows can be tested end-to-end safely. With no recipient chosen, the
 *     email is suppressed (logged only).
 *   - Allowlist escape hatch: PMS_ALERT_EMAIL (always) and anything in OUTREACH_ALLOWLIST
 *     may receive mail off production. Needed because the cookie picker only works inside a
 *     request context whose cookies are OURS — background work (the nightly PMS sync digest,
 *     webhooks) has no cookies at all, and a landlord-triggered PMS report carries the
 *     landlord's cookies, not a tester's. Both would otherwise be silently suppressed,
 *     leaving a pilot with no way to observe itself.
 *     Deliberately all-or-nothing per message: a message is only sent when EVERY one of
 *     its recipients is allowlisted, so a digest that happens to include a real landlord
 *     from the prod snapshot falls back to redirect/suppress rather than partially sending.
 *
 * Use it everywhere instead of calling transporter.sendMail() directly. For non-email
 * outreach, gate the call site with outreachEnabled().
 */
import { outreachEnabled, isPilot } from "./appEnv.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RECIPIENT_COOKIE = "staging_email_to";

/*
 * On a pilot, every outbound email goes here and nowhere else.
 *
 * A pilot has a real property manager on the other side and no tester at a
 * browser, so neither of the usual off-production mechanisms fits: the cookie
 * picker is hidden from them (see layout.js) and would carry THEIR cookies
 * anyway, and plain suppression would mean a landlord-triggered email silently
 * going nowhere. Hard-coded rather than an env var: the whole point is that a
 * pilot cannot be misconfigured into mailing a real user.
 */
export const PILOT_INBOX = "info@useproximity.org";

function allowlist() {
  return new Set(
    // PMS_ALERT_EMAIL is allowlisted implicitly. It is an operator inbox by
    // definition — the only thing addressed to it is our own monitoring — and
    // requiring a second variable to be set in lockstep just to make the first
    // one work is a trap: the emails would go silently missing, which is
    // exactly the failure the PMS reports exist to prevent.
    [process.env.OUTREACH_ALLOWLIST, process.env.PMS_ALERT_EMAIL]
      .filter(Boolean)
      .join(",")
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

  // Pilot: one destination, no exceptions, checked before every other rule so
  // nothing can route around it.
  if (isPilot()) {
    const original = recipientAddresses(message?.to);
    const alreadyThere = original.length === 1 && original[0] === PILOT_INBOX;
    console.log(`[outreach pilot] → ${PILOT_INBOX}${alreadyThere ? "" : ` (was ${original.join(", ") || "none"})`} subject=${message?.subject}`);
    return transporter.sendMail({
      ...message,
      to: PILOT_INBOX,
      // Dropped so a real address on a snapshot record can never be copied in.
      cc: undefined,
      bcc: undefined,
      // Only tag the subject when it was actually rerouted. The PMS reports are
      // addressed here on purpose and read better without a prefix.
      subject: alreadyThere
        ? message?.subject
        : `[PILOT → was: ${original.join(", ") || "none"}] ${message?.subject ?? ""}`,
    });
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
