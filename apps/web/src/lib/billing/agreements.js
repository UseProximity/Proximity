/*
 * Each landlord's commission agreement (landlord_agreements). Landlords sign in
 * the app, inside the Payments tab, through Documenso; admins can still record a
 * paper-signed agreement by hand.
 *
 * A landlord holds at most one current signature (status signed) and, while they
 * sign a newer version, one record in progress (not_sent or sent). A signature
 * replaced by a newer one becomes superseded; a record that ends without one is
 * voided, with ended_reason saying why (declined, cancelled, voided by an admin).
 *
 * Whether a signature still counts is decided by the versions: a version made live
 * with "existing signers must re-sign" invalidates signatures on every earlier
 * version (agreementVersions.resignCutoff). The listing gate asks agreementState().
 *
 * Signing in the app:
 *   startSigning      makes (or reuses) the landlord's Documenso copy of the live
 *                     version and returns the token the Payments tab embeds
 *   syncAgreement     asks Documenso how an in-progress copy stands (on page load,
 *                     and when the embed says it finished), so a late or lost
 *                     webhook never leaves a landlord stuck
 *   applyEnvelope     what the webhook and syncAgreement both run: a completed
 *                     copy is stored and marked signed, a declined or cancelled one
 *                     is voided. Safe to run any number of times.
 *
 * `db` is a service-role Supabase client and `documenso` a client from documenso.js.
 * `options.storeSigned({ userId, bytes })` stores a signed PDF and returns its key
 * (agreementFiles.storeSignedAgreement); `options.notify.declined` tells the team.
 */
import { BillingError } from "./errors.js";
import { withSettingsLock } from "./settings.js";
import { getLiveVersion, resignCutoff, signatureStillValid } from "./agreementVersions.js";
import { signerOf } from "./documenso.js";

const COLUMNS =
  "id, user_id, version, version_id, status, signed_at, signer_name, signer_title, authorized_at, signed_file_key, provider, provider_envelope_id, ended_reason, ended_at, created_at, updated_at, agreement_version:agreement_versions!version_id(id, label, published_at)";
// Before the agreement_versions migration: the columns 202610310001 created.
const LEGACY_COLUMNS =
  "id, user_id, version, status, signed_at, signer_name, signed_file_key, provider, provider_envelope_id, created_at, updated_at";
const UNIQUE_VIOLATION = "23505";
const SIGNER_TITLE_MAX = 100;

const missingSchema = (error) => ["PGRST205", "42P01", "42703", "PGRST200", "PGRST204"].includes(error?.code);

async function readRows(build) {
  const first = await build(COLUMNS);
  if (!missingSchema(first.error)) {
    if (first.error) throw first.error;
    return first.data;
  }
  const legacy = await build(LEGACY_COLUMNS);
  if (missingSchema(legacy.error)) return [];
  if (legacy.error) throw legacy.error;
  return legacy.data;
}

// ── Reading ─────────────────────────────────────────────────────────────────

// The pure part of agreementState: one landlord's rows (newest first) to where they stand.
export function summarizeAgreementRows(rows, { liveVersion = null, cutoff = null } = {}) {
  const signed = rows.find((r) => r.status === "signed") ?? null;
  const pending = rows.find((r) => r.status === "not_sent" || r.status === "sent") ?? null;
  const lastEnded = rows.find((r) => r.status === "voided") ?? null;
  const valid = !!signed && signatureStillValid(signed.agreement_version?.published_at ?? null, cutoff);
  return { signed, pending, lastEnded, liveVersion, cutoff, valid, needsResign: !!signed && !valid };
}

/*
 * Where one landlord stands. `signed` is their current signature and `pending`
 * a record in progress (each null if none). `valid` is what the listing gate uses.
 */
export async function agreementState(db, userId) {
  const [rows, liveVersion, cutoff] = await Promise.all([
    readRows((cols) =>
      db.from("landlord_agreements").select(cols).eq("user_id", userId).order("created_at", { ascending: false }).limit(20)
    ),
    getLiveVersion(db),
    resignCutoff(db),
  ]);
  return summarizeAgreementRows(rows, { liveVersion, cutoff });
}

// The landlord's current signature, for downloading their signed copy.
export async function getSignedAgreement(db, userId) {
  const rows = await readRows((cols) =>
    db.from("landlord_agreements").select(cols).eq("user_id", userId).eq("status", "signed").limit(1)
  );
  return rows[0] ?? null;
}

/*
 * What the landlord's Payments tab shows.
 *   status   signed | needs_resign | in_progress | not_signed
 *   canSign  there is a live version they can sign in the app right now
 */
export function agreementView(state, { signingAvailable = true } = {}) {
  const { signed, pending, lastEnded, liveVersion, valid, needsResign } = state;
  const status = valid ? "signed" : needsResign ? "needs_resign" : pending?.provider_envelope_id ? "in_progress" : "not_signed";
  const declined =
    !pending && !valid && lastEnded?.ended_reason?.startsWith("declined") ? lastEnded.ended_at ?? lastEnded.updated_at : null;
  return {
    status,
    signedAt: signed?.signed_at ?? null,
    signerName: signed?.signer_name ?? null,
    signerTitle: signed?.signer_title ?? null,
    signedVersionLabel: signed?.agreement_version?.label ?? signed?.version ?? null,
    hasSignedFile: !!signed?.signed_file_key,
    liveVersionLabel: liveVersion?.label ?? null,
    canSign: !valid && signingAvailable && !!liveVersion?.provider_template_id && !!liveVersion?.provider_recipient_id,
    declinedAt: declined,
  };
}

// ── Signing in the app ──────────────────────────────────────────────────────

export function cleanSignerTitle(title) {
  const t = String(title ?? "").trim();
  if (!t) throw new BillingError("title_required", "Enter your title, like Owner or Property Manager.");
  if (t.length > SIGNER_TITLE_MAX) throw new BillingError("title_too_long", `Keep your title under ${SIGNER_TITLE_MAX} characters.`);
  return t;
}

async function endRecord(db, row, reason, now = new Date()) {
  const { error } = await db
    .from("landlord_agreements")
    .update({ status: "voided", ended_reason: reason.slice(0, 300), ended_at: now.toISOString() })
    .eq("id", row.id)
    .in("status", ["not_sent", "sent"]);
  if (error) throw error;
}

/*
 * Start (or resume) signing for this landlord and return what the embed needs:
 * { token } for Documenso's signing page, or { alreadySigned: true }.
 *
 * One signing session per landlord at a time (a lock), so a double click cannot
 * make two Documenso copies. An unfinished copy of the live version is reused; one
 * of an older version is cancelled and replaced.
 */
export async function startSigning(db, documenso, { user, signerTitle, authorized, now = new Date(), ...options }) {
  if (authorized !== true) {
    throw new BillingError("authorization_required", "Confirm that you are authorised to sign for this landlord or company.");
  }
  const title = cleanSignerTitle(signerTitle);
  if (!user?.email) throw new BillingError("no_email", "Your account needs an email address to sign.");

  return withSettingsLock(
    db,
    {
      key: `agreement_sign:${user.id}`,
      staleMs: 2 * 60 * 1000,
      now,
      busyMessage: "Your agreement is already being prepared. Try again in a moment.",
    },
    async () => {
      const state = await agreementState(db, user.id);
      if (state.valid) return { alreadySigned: true };
      const live = state.liveVersion;
      if (!live?.provider_template_id || !live.provider_recipient_id) {
        throw new BillingError("not_available", "The commission agreement is not ready to sign yet. We will email you when it is.", 409);
      }

      let row = state.pending;
      if (row?.provider_envelope_id) {
        if (row.version_id === live.id) {
          const envelope = await documenso.getEnvelope(row.provider_envelope_id);
          if (envelope.status === "PENDING") {
            const token = signerOf(envelope)?.token;
            if (token) {
              const { error } = await db
                .from("landlord_agreements")
                .update({ signer_title: title, authorized_at: now.toISOString() })
                .eq("id", row.id);
              if (error) throw error;
              return { token };
            }
          }
          const applied = await applyEnvelope(db, documenso, envelope, { ...options, now });
          if (applied === "signed") return { alreadySigned: true };
          // Declined, cancelled or never sent: it is replaced below.
          if (applied === "unchanged") await endRecord(db, row, "replaced by a new copy", now);
        } else {
          await documenso.cancel(row.provider_envelope_id, "Replaced by a newer version of the agreement").catch(() => {});
          await endRecord(db, row, "replaced by a newer version", now);
        }
        row = null;
      }

      // The record first, so a Documenso copy is never made without one to find it by.
      const fields = {
        status: "sent",
        version: live.label,
        version_id: live.id,
        provider: "documenso",
        signer_title: title,
        authorized_at: now.toISOString(),
      };
      if (row) {
        const { error } = await db.from("landlord_agreements").update(fields).eq("id", row.id);
        if (error) throw error;
      } else {
        const { data, error } = await db.from("landlord_agreements").insert({ user_id: user.id, ...fields }).select("id").single();
        if (error) throw error;
        row = data;
      }

      const copy = await documenso.createSigningCopy({
        templateId: live.provider_template_id,
        recipientId: live.provider_recipient_id,
        titleFieldId: live.provider_title_field_id,
        signerTitle: title,
        email: user.email,
        name: user.name || user.email,
        externalId: `landlord-agreement:${row.id}`,
      });
      const { error } = await db.from("landlord_agreements").update({ provider_envelope_id: copy.envelopeId }).eq("id", row.id);
      if (error) throw error;
      return { token: copy.token };
    }
  );
}

/*
 * Apply what Documenso says about one landlord's copy. `envelope` is a fresh
 * GET /envelope/{id}, never a webhook body taken on trust. Returns what happened:
 * "signed", "declined", "cancelled", "unchanged" or "unknown" (not one of ours).
 */
export async function applyEnvelope(db, documenso, envelope, { storeSigned, notify = {}, now = new Date() } = {}) {
  const { data: row, error } = await db
    .from("landlord_agreements")
    .select("id, user_id, status")
    .eq("provider_envelope_id", envelope.id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return "unknown";
  if (row.status !== "sent" && row.status !== "not_sent") return "unchanged";

  if (envelope.status === "COMPLETED") {
    const signer = signerOf(envelope);
    let signedFileKey = null;
    if (storeSigned) {
      const bytes = await documenso.downloadSigned(envelope);
      signedFileKey = await storeSigned({ userId: row.user_id, bytes });
    }
    // The old signature steps aside first: one current signature per landlord.
    const { error: supersedeError } = await db
      .from("landlord_agreements")
      .update({ status: "superseded", ended_reason: "replaced by a newer signature", ended_at: now.toISOString() })
      .eq("user_id", row.user_id)
      .eq("status", "signed")
      .neq("id", row.id);
    if (supersedeError) throw supersedeError;
    const { data: signedRow, error: signError } = await db
      .from("landlord_agreements")
      .update({
        status: "signed",
        signed_at: signer?.signedAt ?? envelope.completedAt ?? now.toISOString(),
        signer_name: signer?.name || signer?.email || "Signed in Documenso",
        ...(signedFileKey && { signed_file_key: signedFileKey }),
      })
      .eq("id", row.id)
      .in("status", ["sent", "not_sent"])
      .select("id")
      .maybeSingle();
    if (signError) throw signError;
    return signedRow ? "signed" : "unchanged";
  }

  if (envelope.status === "REJECTED") {
    const reason = signerOf(envelope)?.rejectionReason;
    await endRecord(db, row, `declined${reason ? `: ${reason}` : ""}`, now);
    if (notify.declined) {
      const { data: landlord } = await db.from("users").select("id, name, email").eq("id", row.user_id).maybeSingle();
      try {
        await notify.declined({ landlord, reason: reason ?? null });
      } catch (err) {
        console.error("billing: decline email failed", err?.message);
      }
    }
    return "declined";
  }

  if (envelope.status === "CANCELLED") {
    await endRecord(db, row, "cancelled in Documenso", now);
    return "cancelled";
  }
  return "unchanged";
}

// Ask Documenso about this landlord's copy in progress, if any. Never throws for a
// Documenso problem: the page still loads, showing the last known state.
export async function syncAgreement(db, documenso, userId, options = {}) {
  const { data: pending, error } = await db
    .from("landlord_agreements")
    .select("id, provider_envelope_id")
    .eq("user_id", userId)
    .in("status", ["not_sent", "sent"])
    .not("provider_envelope_id", "is", null)
    .maybeSingle();
  if (missingSchema(error)) return "unchanged";
  if (error) throw error;
  if (!pending) return "unchanged";
  try {
    const envelope = await documenso.getEnvelope(pending.provider_envelope_id);
    return await applyEnvelope(db, documenso, envelope, options);
  } catch (err) {
    if (err?.name === "DocumensoError") {
      console.error("billing: could not sync agreement", err.message);
      return "unchanged";
    }
    throw err;
  }
}

// ── Recorded by an admin (paper signatures) ─────────────────────────────────

async function insertAgreement(db, fields) {
  const { data, error } = await db.from("landlord_agreements").insert(fields).select("id, status").single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new BillingError("status_changed", "That agreement was just updated. Refresh and try again.", 409);
    throw error;
  }
  return data;
}

async function versionFields(db) {
  const live = await getLiveVersion(db);
  return live ? { version: live.label, version_id: live.id } : { version: "manual" };
}

export async function markAgreementSent(db, { userId }) {
  const state = await agreementState(db, userId);
  if (state.pending) {
    if (state.pending.status === "sent") return state.pending;
    const { data, error } = await db.from("landlord_agreements").update({ status: "sent" }).eq("id", state.pending.id).select("id, status").single();
    if (error) throw error;
    return data;
  }
  if (state.valid) throw new BillingError("already_signed", "This agreement is already signed.", 409);
  return insertAgreement(db, { user_id: userId, status: "sent", provider: "manual", ...(await versionFields(db)) });
}

export async function markAgreementSigned(db, { userId, signerName, signerTitle = null, signedAt = new Date(), signedFileKey = null }) {
  const name = String(signerName ?? "").trim();
  if (!name) throw new BillingError("signer_required", "Who signed the agreement?");
  const when = new Date(signedAt);
  if (Number.isNaN(when.getTime())) throw new BillingError("bad_date", "That is not a valid signing date.");
  // A signing date in the future is a typo; allow a day for time zones.
  if (when.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new BillingError("bad_date", "The signing date cannot be in the future.");
  }

  const fields = {
    status: "signed",
    signed_at: when.toISOString(),
    signer_name: name,
    ...(signerTitle && { signer_title: String(signerTitle).trim().slice(0, SIGNER_TITLE_MAX) }),
    ...(signedFileKey && { signed_file_key: signedFileKey }),
  };

  const state = await agreementState(db, userId);
  if (state.signed) {
    const { error } = await db
      .from("landlord_agreements")
      .update({ status: "superseded", ended_reason: "replaced by a signature recorded by an admin", ended_at: new Date().toISOString() })
      .eq("id", state.signed.id);
    if (error) throw error;
  }
  if (state.pending) {
    const { data, error } = await db
      .from("landlord_agreements")
      .update({ ...fields, ...(state.pending.provider_envelope_id ? {} : { provider: "manual" }) })
      .eq("id", state.pending.id)
      .select("id, status")
      .single();
    if (error) throw error;
    return data;
  }
  return insertAgreement(db, { user_id: userId, provider: "manual", ...(await versionFields(db)), ...fields });
}

// Void the record in progress if there is one, otherwise the current signature.
// A Documenso copy still waiting is cancelled there too, best effort.
export async function voidAgreement(db, documenso, { userId }) {
  const state = await agreementState(db, userId);
  const target = state.pending ?? state.signed;
  if (!target) throw new BillingError("not_found", "This landlord has no agreement to void.", 404);
  if (target.provider_envelope_id && target.status !== "signed" && documenso) {
    await documenso.cancel(target.provider_envelope_id, "Voided by Proximity").catch(() => {});
  }
  const { data, error } = await db
    .from("landlord_agreements")
    .update({ status: "voided", ended_reason: "voided by an admin", ended_at: new Date().toISOString() })
    .eq("id", target.id)
    .select("id, status")
    .single();
  if (error) throw error;
  return data;
}
