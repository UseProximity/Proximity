/*
 * The Missouri Real Estate Commission's Broker Disclosure Form (MREC, 2026-11-05).
 *
 * The MREC gives brokers a standard disclosure form to hand out. Nothing needs to
 * be signed or sent back, so we email it to every new landlord once, for their
 * records. Landlords who were already on Proximity get it in the launch email
 * about the commission agreement instead, so nothing here sends to them.
 *
 * An admin uploads the PDF in Billing > Agreements. Only its storage key is kept,
 * in billing_settings under MREC_FORM_SETTING:
 *   { key, fileName, size, uploadedAt, uploadedBy }
 * Until one is uploaded, nothing is sent.
 *
 * When it is sent: the first time an account is both a landlord and has a
 * confirmed address. That is the email verification for a landlord who signed
 * up with a password, or the switch to landlord for anyone else (Google and
 * Apple addresses are confirmed already). Each account gets it once: an earlier
 * send that did not fail, found in sent_emails, means it is not sent again.
 *
 * Sending never breaks the request that triggered it. Callers run it after the
 * response (next/server `after`) and every failure is logged, not thrown.
 *
 * Relative imports only, and the email and storage modules are loaded when a
 * send happens, so the node test runner can load this file.
 */

import { getBillingSetting, setBillingSetting } from "../billing/settings.js";

export const MREC_FORM_SETTING = "mrec_disclosure_form";
export const MREC_FORM_KIND = "mrec_disclosure_form";
export const MREC_FORM_SUBJECT = "Missouri Broker Disclosure Form (for your records, no reply needed)";
export const MREC_FORM_FILENAME = "Missouri-Broker-Disclosure-Form.pdf";

export async function getMrecForm(db) {
  const value = await getBillingSetting(db, MREC_FORM_SETTING, null);
  return value && typeof value === "object" && value.key ? value : null;
}

export async function saveMrecForm(db, { key, fileName, size, adminId, now = new Date() }) {
  const value = { key, fileName: fileName || MREC_FORM_FILENAME, size: size ?? null, uploadedAt: now.toISOString(), uploadedBy: adminId ?? null };
  await setBillingSetting(db, MREC_FORM_SETTING, value, adminId ?? null);
  return value;
}

/*
 * Pure: whether this account should be sent the form now. `user` is a users row
 * with its role name as `role`.
 */
export function mrecFormEligible(user) {
  if (!user || user.role !== "landlord") return false;
  if (user.deleted_at || user.review_sandbox) return false;
  if (typeof user.email !== "string" || !user.email.includes("@")) return false;
  return !!(user.email_verified || user.google_account || user.apple_account);
}

async function alreadySent(db, userId) {
  const { data, error } = await db
    .from("sent_emails")
    .select("id")
    .eq("kind", MREC_FORM_KIND)
    .eq("user_id", userId)
    .neq("status", "failed")
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

const defaultDeps = {
  readFile: async (key) => (await import("../billing/agreementFiles.js")).readAgreementFile(key),
  send: async (args) => (await import("../email.js")).sendMrecFormEmail(args),
};

/*
 * Sends the form to `userId` if they should have it and have not had it.
 * Resolves to a short reason, for logs and tests: "sent", "not_eligible",
 * "already_sent", "no_form" or "error".
 */
export async function sendMrecFormOnce(db, userId, { req = null, deps = defaultDeps } = {}) {
  try {
    if (!userId) return "not_eligible";
    const { data: user, error } = await db
      .from("users")
      .select("id, email, name, deleted_at, email_verified, google_account, apple_account, review_sandbox, roles!role_id(name)")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!mrecFormEligible(user && { ...user, role: user.roles?.name ?? null })) return "not_eligible";

    const form = await getMrecForm(db);
    if (!form) return "no_form";
    if (await alreadySent(db, userId)) return "already_sent";

    const bytes = await deps.readFile(form.key);
    await deps.send({ email: user.email, name: user.name, userId: user.id, pdf: bytes, req });
    return "sent";
  } catch (err) {
    console.error(`mrec form: could not send to ${userId}`, err?.message ?? err);
    return "error";
  }
}
