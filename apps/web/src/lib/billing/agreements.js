/*
 * The commission agreement, as scaffolding. There is one live agreement record
 * per landlord (status not_sent, sent, signed or voided) and no e-signature
 * provider yet: until one is chosen, an admin records the agreement as sent and
 * then signed (with the signed PDF) by hand. The listing gate reads only the
 * status, so adding a provider later changes who sets it, not the gate.
 *
 *   send   not_sent -> sent. The admin sent it outside the app.
 *   sign   -> signed, with who signed, when, and optionally the signed file.
 *   void   the live record is voided, so a new agreement can be started.
 *
 * provider and provider_envelope_id stay empty; agreementProviders.js is where a
 * provider plugs in.
 *
 * `db` is a service-role Supabase client, passed in so this stays testable.
 */
import { BillingError } from "./errors.js";
import { CURRENT_AGREEMENT_VERSION } from "./constants.js";

const COLUMNS =
  "id, user_id, version, status, signed_at, signer_name, signed_file_key, provider, provider_envelope_id, created_at, updated_at";
const UNIQUE_VIOLATION = "23505";

export function agreementView(row) {
  if (!row) return { status: "none", version: null, signedAt: null, signerName: null, hasSignedFile: false };
  return {
    status: row.status,
    version: row.version,
    signedAt: row.signed_at ?? null,
    signerName: row.signer_name ?? null,
    hasSignedFile: !!row.signed_file_key,
  };
}

// The landlord's live (not voided) agreement, or null.
export async function getLiveAgreement(db, userId) {
  const { data, error } = await db
    .from("landlord_agreements")
    .select(COLUMNS)
    .eq("user_id", userId)
    .neq("status", "voided")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function insertAgreement(db, fields) {
  const { data, error } = await db.from("landlord_agreements").insert(fields).select(COLUMNS).single();
  if (error) {
    // Two admins starting one at once: the second sees the first's record.
    if (error.code === UNIQUE_VIOLATION) throw new BillingError("status_changed", "That agreement was just updated. Refresh and try again.", 409);
    throw error;
  }
  return data;
}

async function updateAgreement(db, id, patch) {
  const { data, error } = await db.from("landlord_agreements").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function markAgreementSent(db, { userId }) {
  const live = await getLiveAgreement(db, userId);
  if (!live) return insertAgreement(db, { user_id: userId, version: CURRENT_AGREEMENT_VERSION, status: "sent" });
  if (live.status === "signed") throw new BillingError("already_signed", "This agreement is already signed.", 409);
  if (live.status === "sent") return live;
  return updateAgreement(db, live.id, { status: "sent" });
}

export async function markAgreementSigned(db, { userId, signerName, signedAt = new Date(), signedFileKey = null }) {
  const name = String(signerName ?? "").trim();
  if (!name) throw new BillingError("signer_required", "Who signed the agreement?");
  const when = new Date(signedAt);
  if (Number.isNaN(when.getTime())) throw new BillingError("bad_date", "That is not a valid signing date.");
  // A signing date in the future is a typo; allow a day for time zones.
  if (when.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new BillingError("bad_date", "The signing date cannot be in the future.");
  }

  const fields = { status: "signed", signed_at: when.toISOString(), signer_name: name };
  if (signedFileKey) fields.signed_file_key = signedFileKey;

  const live = await getLiveAgreement(db, userId);
  if (!live) return insertAgreement(db, { user_id: userId, version: CURRENT_AGREEMENT_VERSION, ...fields });
  return updateAgreement(db, live.id, fields);
}

export async function voidAgreement(db, { userId }) {
  const live = await getLiveAgreement(db, userId);
  if (!live) throw new BillingError("not_found", "This landlord has no live agreement to void.", 404);
  return updateAgreement(db, live.id, { status: "voided" });
}

// Every landlord's live agreement, for the admin list, with who they are.
export async function listAgreements(db) {
  const { data, error } = await db
    .from("landlord_agreements")
    .select(`${COLUMNS}, landlord:users!user_id(name, email)`)
    .neq("status", "voided")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    userId: row.user_id,
    landlord: { name: row.landlord?.name ?? null, email: row.landlord?.email ?? null },
    ...agreementView(row),
    provider: row.provider ?? null,
  }));
}
