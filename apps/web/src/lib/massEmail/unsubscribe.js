/*
 * Unsubscribing from mass email (Wyatt, 2026-11-08).
 *
 * Every mass email carries a personal unsubscribe link in its footer and the
 * List-Unsubscribe headers that make Gmail and Yahoo show their own
 * "Unsubscribe" button next to the sender. Either one adds the address to
 * mass_email_unsubscribes, and sendBatch skips it from then on.
 *
 * This is deliberately NOT email_suppressions: that table also stops chat alerts
 * (fn_email_suppressed), and leaving the announcements must never cut someone off
 * from their own conversations, password resets or invoices.
 *
 * The link carries a signed token naming the address, so nobody can unsubscribe
 * someone else by guessing. It never expires: CAN-SPAM wants an opt-out that
 * keeps working, and an old email in someone's inbox should still work.
 *
 * Relative imports only, so the node test runner can load it.
 */

import crypto from "crypto";

const PURPOSE = "mass-unsub";
export const UNSUBSCRIBE_SOURCES = ["link", "one_click"];

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET must be set");
  return s;
}

const hmac = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();

export function signUnsubscribeToken(email) {
  const payload = Buffer.from(JSON.stringify({ p: PURPOSE, e: normalizeEmail(email) })).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

// The address the token names, or null when it is malformed or not ours.
export function verifyUnsubscribeToken(token) {
  const [payload, sig] = String(token ?? "").split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(hmac(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data?.p !== PURPOSE || typeof data.e !== "string" || !data.e.includes("@")) return null;
    return data.e;
  } catch {
    return null;
  }
}

const base = (baseUrl) => String(baseUrl ?? "").replace(/\/$/, "");

// The page a person lands on from the footer link.
export function unsubscribePageUrl(email, baseUrl) {
  return `${base(baseUrl)}/unsubscribe?t=${signUnsubscribeToken(email)}`;
}

/*
 * RFC 8058 one-click headers. Gmail and Yahoo POST "List-Unsubscribe=One-Click"
 * to the https address with no cookies or page in between; the mailto is the
 * fallback for clients that only know the older form.
 */
export function unsubscribeHeaders(email, baseUrl, mailbox) {
  const oneClick = `${base(baseUrl)}/api/unsubscribe?t=${signUnsubscribeToken(email)}`;
  return {
    "List-Unsubscribe": `<${oneClick}>, <mailto:${mailbox}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// Of these addresses, the ones that unsubscribed (lower-cased).
export async function unsubscribedAmong(db, emails) {
  const list = [...new Set(emails.filter(Boolean).map(normalizeEmail))];
  if (!list.length) return new Set();
  const { data, error } = await db.from("mass_email_unsubscribes").select("email").in("email", list);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.email));
}

export async function unsubscribe(db, email, source) {
  const { error } = await db
    .from("mass_email_unsubscribes")
    .upsert({ email: normalizeEmail(email), source: UNSUBSCRIBE_SOURCES.includes(source) ? source : "link" }, { onConflict: "email", ignoreDuplicates: true });
  if (error) throw error;
}

export async function resubscribe(db, email) {
  const { error } = await db.from("mass_email_unsubscribes").delete().eq("email", normalizeEmail(email));
  if (error) throw error;
}
