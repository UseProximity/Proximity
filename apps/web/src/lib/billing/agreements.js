/*
 * Each landlord's commission agreement: one master agreement (landlord_agreements)
 * with an Exhibit A of covered properties, and Exhibit A amendments
 * (agreement_amendments) for properties added later. Landlords sign in the app
 * through Documenso; admins can still record a paper-signed master by hand.
 * Which properties are covered lives in agreement_coverage (coverage.js).
 *
 * A landlord holds at most one current master (status signed) and, while they
 * sign, one master or one amendment in progress (sent). A master replaced by a
 * newer one becomes superseded; a document that ends without a signature is
 * voided, with ended_reason saying why (declined, cancelled, replaced, voided by
 * an admin), and the properties it proposed are released.
 *
 * Whether a master still counts: signed, inside its one-year term, and on a
 * version a later "everyone must sign again" did not invalidate. A version
 * negotiated with one landlord is never invalidated that way: those landlords are
 * flagged for review instead (decision 14).
 *
 * Signing in the app:
 *   startSigning      works out what the landlord must sign to cover the properties
 *                     being published (planCoverage), makes or reuses that Documenso
 *                     copy with Exhibit A attached, and returns the embed token
 *   syncAgreement     asks Documenso how a copy in progress stands, so a late or lost
 *                     webhook never leaves a landlord stuck
 *   applyEnvelope     what the webhook and syncAgreement both run. Safe to repeat.
 *
 * `db` is a service-role Supabase client and `documenso` a client from documenso.js.
 * Options: storeSigned({ userId, bytes }) -> key, storeExhibit({ userId, bytes }) -> key,
 * landlordAddress(userId) -> string | null, notify.declined({ landlord, reason, kind }),
 * onSigned({ userId, versionId, kind }).
 */
import { BillingError } from "./errors.js";
import { withSettingsLock } from "./settings.js";
import { formatRate, getLiveVersion, resignCutoff, signatureStillValid } from "./agreementVersions.js";
import { signerOf } from "./documenso.js";
import { buildExhibitPdf, INITIALS_BOX } from "./exhibitPdf.js";
import { coveredMap, loadCoverageRows, loadLandlordProperties, planCoverage, resolvePublishedIds } from "./coverage.js";

const VERSION_JOIN = "agreement_version:agreement_versions!version_id(id, label, kind, landlord_id, published_at, commission_rate_percent)";
const COLUMNS = `id, user_id, version, version_id, status, signed_at, signer_name, signer_title, authorized_at, signed_file_key, provider, provider_envelope_id, ended_reason, ended_at, term_start, term_end, exhibit, exhibit_file_key, signed_exhibit_file_key, commission_rate_percent, created_at, updated_at, ${VERSION_JOIN}`;
// Before the coverage migration (202611050001).
const PRE_COVERAGE_COLUMNS =
  "id, user_id, version, version_id, status, signed_at, signer_name, signer_title, authorized_at, signed_file_key, provider, provider_envelope_id, ended_reason, ended_at, created_at, updated_at, agreement_version:agreement_versions!version_id(id, label, published_at)";
// Before the agreement_versions migration: the columns 202610310001 created.
const LEGACY_COLUMNS =
  "id, user_id, version, status, signed_at, signer_name, signed_file_key, provider, provider_envelope_id, created_at, updated_at";
const AMENDMENT_COLUMNS = `id, user_id, agreement_id, version_id, status, previous_exhibit, proposed_exhibit, exhibit_file_key, provider_envelope_id, signed_file_key, signed_exhibit_file_key, signer_name, signer_title, authorized_at, signed_at, ended_reason, ended_at, created_at, updated_at, ${VERSION_JOIN}`;

const UNIQUE_VIOLATION = "23505";
const SIGNER_TITLE_MAX = 100;
const PENDING = ["not_sent", "sent"];

const missingSchema = (error) => ["PGRST205", "42P01", "42703", "PGRST200", "PGRST204"].includes(error?.code);

async function readRows(build) {
  for (const cols of [COLUMNS, PRE_COVERAGE_COLUMNS, LEGACY_COLUMNS]) {
    const res = await build(cols);
    if (!missingSchema(res.error)) {
      if (res.error) throw res.error;
      return res.data;
    }
  }
  return [];
}

// One year from signing: the same calendar date next year.
export function termEndFor(signedAt) {
  const end = new Date(signedAt);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return end.toISOString();
}

// ── Reading ─────────────────────────────────────────────────────────────────

/*
 * The pure part of agreementState: one landlord's master rows (newest first) to
 * where they stand.
 *   valid        the master counts: the listing gate and coverage use it
 *   needsResign  signed, but a later standard version asked everyone to sign again
 *   expired      signed, but its one-year term is over
 */
export function summarizeAgreementRows(rows, { liveVersion = null, cutoff = null, now = new Date() } = {}) {
  const signed = rows.find((r) => r.status === "signed") ?? null;
  const pending = rows.find((r) => PENDING.includes(r.status)) ?? null;
  const lastEnded = rows.find((r) => r.status === "voided") ?? null;
  const negotiated = !!signed?.agreement_version?.landlord_id;
  const versionOk = !!signed && (negotiated || signatureStillValid(signed.agreement_version?.published_at ?? null, cutoff));
  const expired = !!signed?.term_end && new Date(signed.term_end).getTime() <= new Date(now).getTime();
  const valid = !!signed && versionOk && !expired;
  return {
    signed,
    pending,
    lastEnded,
    liveVersion,
    cutoff,
    valid,
    expired: !!signed && expired,
    needsResign: !!signed && !versionOk,
    // A landlord on a negotiated version when a newer standard one asked everyone
    // to sign again: not forced, but the team should look (decision 14).
    flaggedForReview: negotiated && !signatureStillValid(signed.agreement_version?.published_at ?? null, cutoff),
  };
}

async function pendingAmendmentOf(db, userId) {
  const { data, error } = await db
    .from("agreement_amendments")
    .select(AMENDMENT_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "sent")
    .maybeSingle();
  if (missingSchema(error)) return null;
  if (error) throw error;
  return data;
}

/*
 * Where one landlord stands with their master agreement, plus any amendment in
 * progress. `valid` is what the listing gate uses when no particular property is
 * being published.
 */
export async function agreementState(db, userId, now = new Date()) {
  const [rows, liveVersion, cutoff, pendingAmendment] = await Promise.all([
    readRows((cols) =>
      db.from("landlord_agreements").select(cols).eq("user_id", userId).order("created_at", { ascending: false }).limit(20)
    ),
    getLiveVersion(db, { kind: "master", landlordId: userId }),
    resignCutoff(db),
    pendingAmendmentOf(db, userId),
  ]);
  return { ...summarizeAgreementRows(rows, { liveVersion, cutoff, now }), pendingAmendment };
}

/*
 * Everything coverage decisions need for one landlord: their agreement state,
 * their properties, coverage rows, and the Map of listings covered now.
 */
export async function coverageFor(db, userId, now = new Date()) {
  const [state, properties, rows] = await Promise.all([
    agreementState(db, userId, now),
    loadLandlordProperties(db, userId),
    loadCoverageRows(db, userId),
  ]);
  return { state, properties, rows, covered: coveredMap(rows, { master: state.signed, masterValid: state.valid }) };
}

// The landlord's current signature, for downloading their signed copy.
export async function getSignedAgreement(db, userId) {
  const rows = await readRows((cols) =>
    db.from("landlord_agreements").select(cols).eq("user_id", userId).eq("status", "signed").limit(1)
  );
  return rows[0] ?? null;
}

/*
 * Every agreement document a landlord has, newest first, for their Payments tab
 * and the admin's per-landlord history: masters and amendments with what each
 * covered and which signed files exist. Storage keys are not included.
 */
export async function listAgreementDocuments(db, userId) {
  const masters = await readRows((cols) =>
    db.from("landlord_agreements").select(cols).eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
  );
  const { data: amendments, error } = await db
    .from("agreement_amendments")
    .select(AMENDMENT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error && !missingSchema(error)) throw error;
  const docs = [
    ...masters.map((m) => ({
      id: m.id,
      kind: "master",
      status: m.status,
      versionLabel: m.agreement_version?.label ?? m.version ?? null,
      negotiated: !!m.agreement_version?.landlord_id,
      commissionRatePercent: m.commission_rate_percent == null ? null : Number(m.commission_rate_percent),
      signedAt: m.signed_at,
      signerName: m.signer_name,
      signerTitle: m.signer_title,
      termStart: m.term_start ?? null,
      termEnd: m.term_end ?? null,
      properties: Array.isArray(m.exhibit) ? m.exhibit : [],
      previous: null,
      hasSignedFile: !!m.signed_file_key,
      hasSignedExhibit: !!m.signed_exhibit_file_key,
      provider: m.provider,
      endedReason: m.ended_reason ?? null,
      endedAt: m.ended_at ?? null,
      createdAt: m.created_at,
    })),
    ...(amendments ?? []).map((a) => ({
      id: a.id,
      kind: "amendment",
      status: a.status,
      versionLabel: a.agreement_version?.label ?? null,
      negotiated: !!a.agreement_version?.landlord_id,
      commissionRatePercent: null,
      signedAt: a.signed_at,
      signerName: a.signer_name,
      signerTitle: a.signer_title,
      termStart: null,
      termEnd: null,
      properties: Array.isArray(a.proposed_exhibit) ? a.proposed_exhibit : [],
      previous: Array.isArray(a.previous_exhibit) ? a.previous_exhibit : [],
      hasSignedFile: !!a.signed_file_key,
      hasSignedExhibit: !!a.signed_exhibit_file_key,
      provider: "documenso",
      endedReason: a.ended_reason ?? null,
      endedAt: a.ended_at ?? null,
      createdAt: a.created_at,
      masterId: a.agreement_id,
    })),
  ];
  return docs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/*
 * What the landlord's Payments tab shows.
 *   status   signed | needs_resign | expired | in_progress | not_signed
 *   canSign  there is a live version they can sign in the app right now
 *   covered / uncoveredLive   their properties on and off Exhibit A
 *   amendment                 an amendment in progress, if any
 */
export function agreementView(state, { signingAvailable = true, properties = [], covered = new Map() } = {}) {
  const { signed, pending, pendingAmendment, lastEnded, liveVersion, valid, needsResign, expired } = state;
  const inProgress = !!pending?.provider_envelope_id;
  const status = valid ? "signed" : needsResign ? "needs_resign" : expired ? "expired" : inProgress ? "in_progress" : "not_signed";
  const declined =
    !pending && !valid && lastEnded?.ended_reason?.startsWith("declined") ? lastEnded.ended_at ?? lastEnded.updated_at : null;
  const coveredList = properties.filter((p) => covered.has(p.listingId)).map((p) => ({ listingId: p.listingId, address: p.address, units: p.units }));
  // Covered properties the landlord no longer has a stake in stay on the record.
  for (const [listingId, row] of covered) {
    if (!coveredList.some((c) => c.listingId === listingId)) coveredList.push({ listingId, address: row.address, units: row.units ?? [] });
  }
  return {
    status,
    signedAt: signed?.signed_at ?? null,
    signerName: signed?.signer_name ?? null,
    signerTitle: signed?.signer_title ?? null,
    signedVersionLabel: signed?.agreement_version?.label ?? signed?.version ?? null,
    commissionRatePercent: signed?.commission_rate_percent == null ? null : Number(signed.commission_rate_percent),
    termEnd: signed?.term_end ?? null,
    hasSignedFile: !!signed?.signed_file_key,
    hasSignedExhibit: !!signed?.signed_exhibit_file_key,
    liveVersionLabel: liveVersion?.label ?? null,
    canSign: !valid && signingAvailable && !!liveVersion?.provider_template_id && !!liveVersion?.provider_recipient_id,
    declinedAt: declined,
    covered: coveredList,
    uncoveredLive: properties.filter((p) => p.live && !covered.has(p.listingId)).map((p) => ({ listingId: p.listingId, address: p.address })),
    amendment: pendingAmendment?.provider_envelope_id
      ? { id: pendingAmendment.id, adding: addedBy(pendingAmendment).map((e) => e.address), createdAt: pendingAmendment.created_at }
      : null,
  };
}

const addedBy = (amendment) => {
  const before = new Set((amendment?.previous_exhibit ?? []).map((e) => e.listingId));
  return (amendment?.proposed_exhibit ?? []).filter((e) => !before.has(e.listingId));
};

// ── Signing in the app ──────────────────────────────────────────────────────

export function cleanSignerTitle(title) {
  const t = String(title ?? "").trim();
  if (!t) throw new BillingError("title_required", "Enter your title, like Owner or Property Manager.");
  if (t.length > SIGNER_TITLE_MAX) throw new BillingError("title_too_long", `Keep your title under ${SIGNER_TITLE_MAX} characters.`);
  return t;
}

const TABLE = { master: "landlord_agreements", amendment: "agreement_amendments" };

// End a document in progress and release the properties it proposed.
async function endDocument(db, kind, row, reason, now = new Date()) {
  const { error } = await db
    .from(TABLE[kind])
    .update({ status: "voided", ended_reason: reason.slice(0, 300), ended_at: now.toISOString() })
    .eq("id", row.id)
    .in("status", PENDING);
  if (error) throw error;
  await releaseProposed(db, kind, row.id, now);
}

async function releaseProposed(db, kind, docId, now = new Date()) {
  let q = db.from("agreement_coverage").update({ status: "released", released_at: now.toISOString() }).eq("status", "proposed");
  q = kind === "amendment" ? q.eq("amendment_id", docId) : q.eq("agreement_id", docId).is("amendment_id", null);
  const { error } = await q;
  if (error && !missingSchema(error)) throw error;
}

const sameIds = (a, b) => {
  const x = new Set(a.map((e) => e.listingId));
  return x.size === b.length && b.every((e) => x.has(e.listingId));
};

/*
 * Start (or resume) signing for this landlord and return what the embed needs:
 * { token, kind } for Documenso's signing page, or { alreadySigned: true } when
 * everything asked for is already covered.
 *
 * `listingIds` are the properties being published (empty when they sign from the
 * Payments tab). One signing session per landlord at a time (a lock), so a double
 * click cannot make two copies. A copy in progress for exactly the same document
 * is reused; otherwise it is cancelled, and the new copy keeps every property the
 * old one proposed.
 */
export async function startSigning(
  db,
  documenso,
  { user, signerTitle, authorized, listingIds = [], now = new Date(), storeExhibit, landlordAddress, ...options }
) {
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
      const requested = await resolvePublishedIds(db, listingIds);
      const { state, properties, rows } = await coverageFor(db, user.id, now);

      // The document in progress, if any. An amendment only stands while its master counts.
      let inProgress = null;
      // Properties an amendment to a master that no longer counts was adding: they
      // go on the new master instead of being dropped.
      let carryFromAmendment = [];
      if (state.valid && state.pendingAmendment) inProgress = { kind: "amendment", row: state.pendingAmendment, entries: state.pendingAmendment.proposed_exhibit ?? [] };
      else if (state.pending) inProgress = { kind: "master", row: state.pending, entries: state.pending.exhibit ?? [] };
      if (!state.valid && state.pendingAmendment) {
        carryFromAmendment = state.pendingAmendment.proposed_exhibit ?? [];
        await cancelInDocumenso(documenso, state.pendingAmendment, "Replaced by a new agreement");
        await endDocument(db, "amendment", state.pendingAmendment, "replaced by a new agreement", now);
      }

      const plan = planCoverage({
        properties,
        rows,
        master: state.signed,
        masterValid: state.valid,
        requestedIds: requested,
        carry: [...(inProgress?.entries ?? []), ...carryFromAmendment],
      });
      if (plan.kind === "none") {
        if (inProgress) {
          await cancelInDocumenso(documenso, inProgress.row, "No longer needed");
          await endDocument(db, inProgress.kind, inProgress.row, "no longer needed", now);
        }
        return { alreadySigned: true };
      }

      const version = await getLiveVersion(db, { kind: plan.kind, landlordId: user.id });
      if (!version?.provider_template_id || !version.provider_recipient_id) {
        const what = plan.kind === "amendment" ? "The Exhibit A amendment" : "The commission agreement";
        throw new BillingError("not_available", `${what} is not ready to sign yet. We will email you when it is.`, 409);
      }

      // Reuse the copy in progress when it is exactly this document.
      if (inProgress?.row.provider_envelope_id) {
        const same = inProgress.kind === plan.kind && inProgress.row.version_id === version.id && sameIds(inProgress.entries, plan.entries);
        if (same) {
          const envelope = await documenso.getEnvelope(inProgress.row.provider_envelope_id);
          if (envelope.status === "PENDING") {
            const token = signerOf(envelope)?.token;
            if (token) {
              const { error } = await db
                .from(TABLE[inProgress.kind])
                .update({ signer_title: title, authorized_at: now.toISOString() })
                .eq("id", inProgress.row.id);
              if (error) throw error;
              return { token, kind: plan.kind };
            }
          }
          const applied = await applyEnvelope(db, documenso, envelope, { ...options, now });
          if (applied === "signed") return { alreadySigned: true };
        }
      }
      if (inProgress && PENDING.includes((await currentStatus(db, inProgress))?.status)) {
        await cancelInDocumenso(documenso, inProgress.row, "Replaced by a newer copy");
        await endDocument(db, inProgress.kind, inProgress.row, "replaced by a newer copy", now);
      }

      return createDocument(db, documenso, {
        user,
        title,
        plan,
        version,
        master: state.signed,
        now,
        storeExhibit,
        landlordAddress,
      });
    }
  );
}

async function currentStatus(db, doc) {
  const { data, error } = await db.from(TABLE[doc.kind]).select("id, status").eq("id", doc.row.id).maybeSingle();
  if (error) throw error;
  return data;
}

async function cancelInDocumenso(documenso, row, reason) {
  if (row?.provider_envelope_id) await documenso.cancel(row.provider_envelope_id, reason).catch(() => {});
}

async function landlordNameOf(db, user) {
  const { data } = await db.from("users").select("name, company_name").eq("id", user.id).maybeSingle();
  return data?.company_name?.trim() || data?.name?.trim() || user.name || user.email;
}

// Make the record, its proposed coverage, the Exhibit A and the Documenso copy.
async function createDocument(db, documenso, { user, title, plan, version, master, now, storeExhibit, landlordAddress }) {
  const nowIso = now.toISOString();
  const landlordName = await landlordNameOf(db, user);
  const isAmendment = plan.kind === "amendment";

  // The record first, so a Documenso copy is never made without one to find it by.
  const fields = isAmendment
    ? {
        user_id: user.id,
        agreement_id: master.id,
        version_id: version.id,
        status: "sent",
        previous_exhibit: plan.previous,
        proposed_exhibit: plan.entries,
        signer_title: title,
        authorized_at: nowIso,
      }
    : {
        user_id: user.id,
        status: "sent",
        version: version.label,
        version_id: version.id,
        provider: "documenso",
        signer_title: title,
        authorized_at: nowIso,
        exhibit: plan.entries,
        commission_rate_percent: version.commission_rate_percent ?? null,
      };
  const { data: row, error } = await db.from(TABLE[plan.kind]).insert(fields).select("id").single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new BillingError("status_changed", "Your agreement was just updated. Try again.", 409);
    throw error;
  }

  // The properties this document proposes. A master proposes every entry; an
  // amendment only the ones it adds.
  const proposed = isAmendment ? plan.added : plan.entries;
  if (proposed.length) {
    const { error: covError } = await db.from("agreement_coverage").insert(
      proposed.map((e) => ({
        user_id: user.id,
        listing_id: e.listingId,
        address: e.address,
        units: e.units ?? [],
        agreement_id: isAmendment ? master.id : row.id,
        amendment_id: isAmendment ? row.id : null,
        status: "proposed",
      }))
    );
    if (covError) throw covError;
  }

  const exhibit = await buildExhibitPdf({
    kind: plan.kind,
    landlordName,
    entries: plan.entries,
    previous: plan.previous ?? [],
    preparedAt: now,
  });
  const exhibitKey = storeExhibit ? await storeExhibit({ userId: user.id, bytes: exhibit.bytes }) : null;

  const address = landlordAddress ? await landlordAddress(user.id).catch(() => null) : null;
  const copy = await documenso.createSigningCopy({
    templateId: version.provider_template_id,
    recipientId: version.provider_recipient_id,
    titleFieldId: version.provider_title_field_id,
    signerTitle: title,
    prefill: [
      { id: version.provider_rate_field_id, value: formatRate(version.commission_rate_percent) },
      { id: version.provider_address_field_id, value: address },
    ],
    exhibit: {
      bytes: exhibit.bytes,
      fileName: isAmendment ? "exhibit-a-amendment.pdf" : "exhibit-a.pdf",
      pageCount: exhibit.pageCount,
      initialsBox: INITIALS_BOX,
    },
    email: user.email,
    name: user.name || user.email,
    title: isAmendment ? "Exhibit A amendment" : "Commission agreement",
    externalId: `${isAmendment ? "agreement-amendment" : "landlord-agreement"}:${row.id}`,
  });
  const { error: saveError } = await db
    .from(TABLE[plan.kind])
    .update({
      provider_envelope_id: copy.envelopeId,
      ...(copy.exhibitItemId && { provider_exhibit_item_id: copy.exhibitItemId }),
      ...(exhibitKey && { exhibit_file_key: exhibitKey }),
    })
    .eq("id", row.id);
  if (saveError) throw saveError;
  return { token: copy.token, kind: plan.kind };
}

// Which of our documents a Documenso envelope is: { kind, row } or null.
async function findDocument(db, envelopeId) {
  for (const kind of ["master", "amendment"]) {
    const { data, error } = await db
      .from(TABLE[kind])
      .select("id, user_id, status, version_id, agreement_id")
      .eq("provider_envelope_id", envelopeId)
      .maybeSingle();
    if (error && missingSchema(error)) continue;
    if (error) throw error;
    if (data) return { kind, row: data };
  }
  return null;
}

// Store the signed agreement and the signed Exhibit A (when the envelope has one).
async function storeSignedFiles(documenso, envelope, userId, storeSigned) {
  if (!storeSigned) return {};
  if (documenso.downloadSignedItems) {
    const items = await documenso.downloadSignedItems(envelope);
    const keys = {};
    if (items[0]) keys.signed_file_key = await storeSigned({ userId, bytes: items[0].bytes });
    if (items[1]) keys.signed_exhibit_file_key = await storeSigned({ userId, bytes: items[1].bytes });
    return keys;
  }
  return { signed_file_key: await storeSigned({ userId, bytes: await documenso.downloadSigned(envelope) }) };
}

/*
 * Apply what Documenso says about one landlord's copy. `envelope` is a fresh
 * GET /envelope/{id}, never a webhook body taken on trust. Returns what happened:
 * "signed", "declined", "cancelled", "unchanged" or "unknown" (not one of ours).
 */
export async function applyEnvelope(db, documenso, envelope, { storeSigned, notify = {}, onSigned, now = new Date() } = {}) {
  const doc = await findDocument(db, envelope.id);
  if (!doc) return "unknown";
  const { kind, row } = doc;
  if (!PENDING.includes(row.status)) return "unchanged";
  const nowIso = now.toISOString();

  if (envelope.status === "COMPLETED") {
    const signer = signerOf(envelope);
    const files = await storeSignedFiles(documenso, envelope, row.user_id, storeSigned);
    const signedAt = signer?.signedAt ?? envelope.completedAt ?? nowIso;

    if (kind === "master") {
      // The old master steps aside first: one current signature per landlord. An
      // amendment still open against it no longer applies.
      const { data: old, error: oldError } = await db
        .from("landlord_agreements")
        .select("id")
        .eq("user_id", row.user_id)
        .eq("status", "signed")
        .neq("id", row.id);
      if (oldError) throw oldError;
      if (old?.length) {
        const { error } = await db
          .from("landlord_agreements")
          .update({ status: "superseded", ended_reason: "replaced by a newer signature", ended_at: nowIso })
          .in("id", old.map((o) => o.id));
        if (error) throw error;
        const stale = await pendingAmendmentOf(db, row.user_id);
        if (stale && old.some((o) => o.id === stale.agreement_id)) {
          await cancelInDocumenso(documenso, stale, "Replaced by a new agreement");
          await endDocument(db, "amendment", stale, "replaced by a new agreement", now);
        }
      }
    }

    const signFields = {
      status: "signed",
      signed_at: signedAt,
      signer_name: signer?.name || signer?.email || "Signed in Documenso",
      ...files,
      ...(kind === "master" && { term_start: signedAt, term_end: termEndFor(signedAt) }),
    };
    const { data: signedRow, error: signError } = await db
      .from(TABLE[kind])
      .update(signFields)
      .eq("id", row.id)
      .in("status", PENDING)
      .select("id")
      .maybeSingle();
    if (signError) throw signError;
    if (!signedRow) return "unchanged";

    // Only now, with the document signed, do its properties become covered.
    let cover = db.from("agreement_coverage").update({ status: "covered", covered_at: signedAt }).eq("status", "proposed");
    cover = kind === "amendment" ? cover.eq("amendment_id", row.id) : cover.eq("agreement_id", row.id).is("amendment_id", null);
    const { error: coverError } = await cover;
    if (coverError) throw coverError;

    if (onSigned) {
      try {
        await onSigned({ userId: row.user_id, versionId: row.version_id, kind });
      } catch (err) {
        console.error("billing: after-signing step failed", err?.message);
      }
    }
    return "signed";
  }

  if (envelope.status === "REJECTED") {
    const reason = signerOf(envelope)?.rejectionReason;
    await endDocument(db, kind, row, `declined${reason ? `: ${reason}` : ""}`, now);
    if (notify.declined) {
      const { data: landlord } = await db.from("users").select("id, name, email").eq("id", row.user_id).maybeSingle();
      try {
        await notify.declined({ landlord, reason: reason ?? null, kind });
      } catch (err) {
        console.error("billing: decline email failed", err?.message);
      }
    }
    return "declined";
  }

  if (envelope.status === "CANCELLED") {
    await endDocument(db, kind, row, "cancelled in Documenso", now);
    return "cancelled";
  }
  return "unchanged";
}

// Ask Documenso about this landlord's copies in progress, if any. Never throws for
// a Documenso problem: the page still loads, showing the last known state.
export async function syncAgreement(db, documenso, userId, options = {}) {
  const envelopes = [];
  for (const kind of ["master", "amendment"]) {
    const { data, error } = await db
      .from(TABLE[kind])
      .select("id, provider_envelope_id")
      .eq("user_id", userId)
      .in("status", kind === "master" ? PENDING : ["sent"])
      .not("provider_envelope_id", "is", null)
      .maybeSingle();
    if (missingSchema(error)) continue;
    if (error) throw error;
    if (data) envelopes.push(data.provider_envelope_id);
  }
  let result = "unchanged";
  for (const id of envelopes) {
    try {
      const envelope = await documenso.getEnvelope(id);
      const applied = await applyEnvelope(db, documenso, envelope, options);
      if (applied !== "unchanged" && applied !== "unknown") result = applied;
    } catch (err) {
      if (err?.name === "DocumensoError") {
        console.error("billing: could not sync agreement", err.message);
        continue;
      }
      throw err;
    }
  }
  return result;
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

async function versionFields(db, userId) {
  const live = await getLiveVersion(db, { kind: "master", landlordId: userId });
  return live
    ? { version: live.label, version_id: live.id, commission_rate_percent: live.commission_rate_percent ?? null }
    : { version: "manual" };
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
  return insertAgreement(db, { user_id: userId, status: "sent", provider: "manual", ...(await versionFields(db, userId)) });
}

/*
 * A master signed outside the app (on paper), recorded by an admin. Its Exhibit A
 * is taken to be every property the landlord has live on the signing date; they
 * become covered, and the term runs a year from that date.
 */
export async function markAgreementSigned(db, { userId, signerName, signerTitle = null, signedAt = new Date(), signedFileKey = null }) {
  const name = String(signerName ?? "").trim();
  if (!name) throw new BillingError("signer_required", "Who signed the agreement?");
  const when = new Date(signedAt);
  if (Number.isNaN(when.getTime())) throw new BillingError("bad_date", "That is not a valid signing date.");
  // A signing date in the future is a typo; allow a day for time zones.
  if (when.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new BillingError("bad_date", "The signing date cannot be in the future.");
  }

  const properties = await loadLandlordProperties(db, userId);
  const exhibit = properties.filter((p) => p.live).map((p) => ({ listingId: p.listingId, address: p.address, units: p.units }));
  const fields = {
    status: "signed",
    signed_at: when.toISOString(),
    signer_name: name,
    term_start: when.toISOString(),
    term_end: termEndFor(when),
    exhibit,
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
  if (state.pendingAmendment) await endDocument(db, "amendment", state.pendingAmendment, "replaced by a signature recorded by an admin");
  let record;
  if (state.pending) {
    await releaseProposed(db, "master", state.pending.id);
    const { data, error } = await db
      .from("landlord_agreements")
      .update({ ...fields, ...(state.pending.provider_envelope_id ? {} : { provider: "manual" }) })
      .eq("id", state.pending.id)
      .select("id, status")
      .single();
    if (error) throw error;
    record = data;
  } else {
    record = await insertAgreement(db, { user_id: userId, provider: "manual", ...(await versionFields(db, userId)), ...fields });
  }
  if (exhibit.length) {
    const { error } = await db.from("agreement_coverage").insert(
      exhibit.map((e) => ({
        user_id: userId,
        listing_id: e.listingId,
        address: e.address,
        units: e.units,
        agreement_id: record.id,
        status: "covered",
        covered_at: when.toISOString(),
      }))
    );
    if (error) throw error;
  }
  return record;
}

/*
 * Void the document in progress if there is one (an amendment first), otherwise
 * the current master. A Documenso copy still waiting is cancelled there too, best
 * effort. Voiding a signed master ends its coverage with it.
 */
export async function voidAgreement(db, documenso, { userId }) {
  const state = await agreementState(db, userId);
  if (state.pendingAmendment) {
    if (documenso) await cancelInDocumenso(documenso, state.pendingAmendment, "Voided by Proximity");
    await endDocument(db, "amendment", state.pendingAmendment, "voided by an admin");
    return { id: state.pendingAmendment.id, status: "voided", kind: "amendment" };
  }
  const target = state.pending ?? state.signed;
  if (!target) throw new BillingError("not_found", "This landlord has no agreement to void.", 404);
  if (target.provider_envelope_id && target.status !== "signed" && documenso) {
    await cancelInDocumenso(documenso, target, "Voided by Proximity");
  }
  const { data, error } = await db
    .from("landlord_agreements")
    .update({ status: "voided", ended_reason: "voided by an admin", ended_at: new Date().toISOString() })
    .eq("id", target.id)
    .select("id, status")
    .single();
  if (error) throw error;
  if (target.status !== "signed") await releaseProposed(db, "master", target.id);
  return { ...data, kind: "master" };
}

/*
 * The stored key of one of a landlord's signed files, checked to be theirs:
 *   kind  master | amendment     part  agreement | exhibit
 * Without an id, their current master. Null when there is no such file.
 */
export async function documentFileKey(db, { userId, kind = "master", id = null, part = "agreement" }) {
  if (!TABLE[kind] || !["agreement", "exhibit"].includes(part)) return null;
  let q = db.from(TABLE[kind]).select("id, user_id, status, signed_file_key, signed_exhibit_file_key").eq("user_id", userId);
  q = id ? q.eq("id", id) : q.eq("status", "signed");
  const { data, error } = await q.limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return part === "exhibit" ? row.signed_exhibit_file_key ?? null : row.signed_file_key ?? null;
}

/*
 * The signed agreement covering one of a landlord's properties now, for a charge
 * on it: { agreementId, amendmentId, commissionRatePercent } (the master's rate,
 * which a negotiated version may set differently), or null when it is not
 * covered. Whatever creates the charge decides whether to charge at all; this
 * only records which agreement it falls under.
 */
export async function coveringAgreement(db, userId, listingId, now = new Date()) {
  if (!listingId) return null;
  const [state, rows] = await Promise.all([agreementState(db, userId, now), loadCoverageRows(db, userId)]);
  const row = coveredMap(rows, { master: state.signed, masterValid: state.valid }).get(listingId);
  if (!row) return null;
  const rate = state.signed?.commission_rate_percent ?? state.signed?.agreement_version?.commission_rate_percent ?? null;
  return { agreementId: row.agreement_id, amendmentId: row.amendment_id ?? null, commissionRatePercent: rate == null ? null : Number(rate) };
}
