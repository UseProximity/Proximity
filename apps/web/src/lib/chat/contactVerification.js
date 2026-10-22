/*
 * One-click confirmation for per-listing alert addresses.
 *
 * A landlord can have chat alerts for a listing or lease go to a different inbox
 * than their account's (a leasing office per property). That address only starts
 * receiving alerts once someone at it clicks the link we send, because otherwise
 * a typo, or someone else's address, would start receiving students' messages
 * (Wyatt, 2026-10-09). The routing itself is enforced in the database by
 * fn_chat_contact_confirmed; this file only issues and redeems the links.
 *
 * Scoped to (landlord account, address): confirming delmonte@keeleyproperties.com
 * for Keeley's account does not let any other account point alerts at it.
 *
 * Same token shape as chat magic links: the raw token lives only in the email
 * URL, the table stores its SHA-256. The /contact-verify page shows a button
 * rather than confirming on load, so a mail scanner that prefetches the link
 * cannot confirm on the recipient's behalf.
 */
import { createHash, randomBytes } from "crypto";
import supabase from "@/lib/supabase";
import { sendContactVerificationEmail } from "@/lib/email";

const HOUSE_ACCOUNT_EMAIL = "info@useproximity.org";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Saving a form twice should not send two emails.
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeContactEmail(email) {
  const value = typeof email === "string" ? email.trim().toLowerCase() : "";
  return EMAIL_RE.test(value) ? value : null;
}

function hashToken(rawToken) {
  return createHash("sha256").update(String(rawToken), "utf8").digest("hex");
}

/**
 * Status of each address for one landlord.
 *
 *   confirmed    the account's own address, or someone clicked the link
 *   pending      a link has been sent and not yet clicked
 *   unconfirmed  never sent
 *
 * @returns {Promise<Record<string, "confirmed"|"pending"|"unconfirmed">>}
 */
export async function getContactEmailStatuses(landlordId, emails) {
  const wanted = [...new Set((emails ?? []).map(normalizeContactEmail).filter(Boolean))];
  const result = {};
  if (!landlordId || wanted.length === 0) return result;

  const [{ data: account }, { data: rows, error }] = await Promise.all([
    supabase.from("users").select("email").eq("id", landlordId).maybeSingle(),
    supabase
      .from("contact_email_verifications")
      .select("email, verified_at, expires_at")
      .eq("landlord_id", landlordId)
      .in("email", wanted),
  ]);

  if (error) console.error("getContactEmailStatuses failed:", error);

  const accountEmail = normalizeContactEmail(account?.email);
  const byEmail = new Map((rows ?? []).map((r) => [r.email, r]));

  for (const email of wanted) {
    const row = byEmail.get(email);
    if (email === accountEmail || row?.verified_at) {
      result[email] = "confirmed";
    } else if (row?.expires_at && new Date(row.expires_at).getTime() > Date.now()) {
      result[email] = "pending";
    } else {
      result[email] = "unconfirmed";
    }
  }
  return result;
}

/**
 * Send a confirmation link if this address needs one. Safe to call on every
 * save: an address that is already confirmed, is the account's own, or was
 * sent a link in the last few minutes is left alone.
 *
 * Never throws. A failed confirmation email must not fail the save that
 * triggered it; the editor shows the address as unconfirmed and offers a resend.
 *
 * @returns {Promise<"confirmed"|"sent"|"skipped"|"failed">}
 */
export async function requestContactVerification({
  landlordId,
  email,
  listingLabel = null,
  baseUrl,
  force = false,
  testEmailTo = null,
}) {
  try {
    const normalized = normalizeContactEmail(email);
    if (!landlordId || !normalized || normalized === HOUSE_ACCOUNT_EMAIL) return "skipped";

    const { data: landlord } = await supabase
      .from("users")
      .select("name, email")
      .eq("id", landlordId)
      .maybeSingle();
    if (!landlord) return "skipped";
    if (normalizeContactEmail(landlord.email) === normalized) return "confirmed";

    const { data: existing } = await supabase
      .from("contact_email_verifications")
      .select("id, verified_at, requested_at")
      .eq("landlord_id", landlordId)
      .eq("email", normalized)
      .maybeSingle();

    if (existing?.verified_at) return "confirmed";
    if (
      !force
      && existing?.requested_at
      && Date.now() - new Date(existing.requested_at).getTime() < RESEND_COOLDOWN_MS
    ) {
      return "skipped";
    }

    const rawToken = randomBytes(32).toString("base64url");
    const row = {
      landlord_id: landlordId,
      email: normalized,
      token_hash: hashToken(rawToken),
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    };

    const { error } = await supabase
      .from("contact_email_verifications")
      .upsert(row, { onConflict: "landlord_id,email" });
    if (error) {
      console.error("requestContactVerification: upsert failed:", error);
      return "failed";
    }

    await sendContactVerificationEmail({
      to: normalized,
      landlordName: landlord.name,
      listingLabel,
      confirmUrl: `${baseUrl}/contact-verify?token=${encodeURIComponent(rawToken)}`,
      testEmailTo,
    });
    return "sent";
  } catch (err) {
    console.error("requestContactVerification failed:", err);
    return "failed";
  }
}

/**
 * Look a link up without redeeming it, so the page can say what is being
 * confirmed before the click.
 *
 * @returns {Promise<{email: string, landlordName: string|null, confirmed: boolean} | null>}
 */
export async function peekContactVerification(rawToken) {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!token) return null;

  const { data, error } = await supabase
    .from("contact_email_verifications")
    .select("email, verified_at, expires_at, landlord:users!contact_email_verifications_landlord_id_fkey(name)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (error) {
    console.error("peekContactVerification failed:", error);
    return null;
  }
  if (!data) return null;
  if (!data.verified_at && new Date(data.expires_at).getTime() <= Date.now()) return null;

  return {
    email: data.email,
    landlordName: data.landlord?.name ?? null,
    confirmed: Boolean(data.verified_at),
  };
}

/**
 * Redeem a link. The token hash is kept after confirming so a second click
 * shows "already confirmed" instead of "invalid link".
 *
 * @returns {Promise<{email: string} | null>}
 */
export async function confirmContactVerification(rawToken) {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!token) return null;
  const tokenHash = hashToken(token);

  const { data: row, error } = await supabase
    .from("contact_email_verifications")
    .select("id, email, verified_at, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    console.error("confirmContactVerification lookup failed:", error);
    return null;
  }
  if (!row) return null;
  if (row.verified_at) return { email: row.email };
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  const { error: updateError } = await supabase
    .from("contact_email_verifications")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("verified_at", null);

  if (updateError) {
    console.error("confirmContactVerification update failed:", updateError);
    return null;
  }
  return { email: row.email };
}
