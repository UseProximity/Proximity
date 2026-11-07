/*
 * Each landlord's marketing agreement: one master agreement (landlord_agreements)
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
 * Whether a master still counts: signed, and on a version a later "everyone must
 * sign again" did not invalidate. It has no end date in the app: any term is in
 * the agreement's own wording (Wyatt, 2026-11-06), so it never lapses on its own.
 * negotiated with one landlord is never invalidated that way: those landlords are
 * flagged for review instead (decision 14).
 *
 * Signing in the app:
 *   startSigning      works out what the landlord must sign to cover the properties
 *                     being published (planCoverage), makes or reuses that Documenso
 *                     copy, and returns the embed token. With `prepare` it only gets
 *                     the copy ready while the landlord answers the license
 *                     questions; the call with their answer fills those boxes and
 *                     opens it. Adding properties later is a separate Exhibit A
 *                     amendment: the amendment template plus the old and new
 *                     Exhibit A. The signed agreement is never changed.
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
import { getLiveVersion, resignCutoff, signatureStillValid } from "./agreementVersions.js";
import { copyBoxesByKind, fitExhibit, signerOf, templateFieldSummary } from "./documenso.js";
import { INITIALS_BOX, buildExhibitPdf, fmtDate } from "./exhibitPdf.js";
import { coveredMap, coversProperty, exhibitChoice, loadCoverageRows, loadLandlordProperties, missingUnits, planCoverage, resolvePublishedIds } from "./coverage.js";

const VERSION_JOIN = "agreement_version:agreement_versions!version_id(id, label, kind, landlord_id, published_at, commission_rate_percent)";
const COLUMNS = `id, user_id, version, version_id, status, signed_at, signer_name, signer_title, authorized_at, signed_file_key, provider, provider_envelope_id, ended_reason, ended_at, term_start, term_end, exhibit, exhibit_file_key, signed_exhibit_file_key, commission_rate_percent, license_prefill, signer_details, created_at, updated_at, ${VERSION_JOIN}`;
// Before the coverage migration (202611050001).
const PRE_COVERAGE_COLUMNS =
  "id, user_id, version, version_id, status, signed_at, signer_name, signer_title, authorized_at, signed_file_key, provider, provider_envelope_id, ended_reason, ended_at, created_at, updated_at, agreement_version:agreement_versions!version_id(id, label, published_at)";
// Before the agreement_versions migration: the columns 202610310001 created.
const LEGACY_COLUMNS =
  "id, user_id, version, status, signed_at, signer_name, signed_file_key, provider, provider_envelope_id, created_at, updated_at";
const AMENDMENT_COLUMNS = `id, user_id, agreement_id, version_id, status, previous_exhibit, proposed_exhibit, exhibit_file_key, provider_envelope_id, signed_file_key, signed_exhibit_file_key, signer_name, signer_title, authorized_at, signed_at, ended_reason, ended_at, license_prefill, signer_details, created_at, updated_at, ${VERSION_JOIN}`;

const UNIQUE_VIOLATION = "23505";
const SIGNER_TITLE_MAX = 100;
const SIGNER_NAME_MAX = 100;
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

const stlDate = (d) => {
  const [m, day, y] = new Date(d).toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).split("/").map(Number);
  return { y, m, day };
};

// Same calendar day in St. Louis: a copy's date box is only reused on the day it was filled.
const sameDay = (a, b) => {
  const x = stlDate(a);
  const y = stlDate(b);
  return x.y === y.y && x.m === y.m && x.day === y.day;
};

// ── Reading ─────────────────────────────────────────────────────────────────

/*
 * The pure part of agreementState: one landlord's master rows (newest first) to
 * where they stand.
 *   valid        the master counts: the listing gate and coverage use it
 *   needsResign  signed, but a later standard version asked everyone to sign again
 *   expired      always false: agreements have no end date in the app
 */
export function summarizeAgreementRows(rows, { liveVersion = null, cutoff = null, now = new Date() } = {}) {
  const signed = rows.find((r) => r.status === "signed") ?? null;
  const pending = rows.find((r) => PENDING.includes(r.status)) ?? null;
  const lastEnded = rows.find((r) => r.status === "voided") ?? null;
  const negotiated = !!signed?.agreement_version?.landlord_id;
  const versionOk = !!signed && (negotiated || signatureStillValid(signed.agreement_version?.published_at ?? null, cutoff));
  const expired = false;
  const valid = !!signed && versionOk;
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
  const view = (p, row) => ({ listingId: p.listingId, address: p.address, wholeBuilding: row.whole_building !== false, units: row.whole_building !== false ? [] : row.units ?? [] });
  const coveredList = properties.filter((p) => covered.has(p.listingId)).map((p) => view(p, covered.get(p.listingId)));
  // Covered properties the landlord no longer has a stake in stay on the record.
  for (const [listingId, row] of covered) {
    if (!coveredList.some((c) => c.listingId === listingId)) coveredList.push(view({ listingId, address: row.address }, row));
  }
  return {
    status,
    signedAt: signed?.signed_at ?? null,
    signerName: signed?.signer_name ?? null,
    signerTitle: signed?.signer_title ?? null,
    signedVersionLabel: signed?.agreement_version?.label ?? signed?.version ?? null,
    commissionRatePercent: signed?.commission_rate_percent == null ? null : Number(signed.commission_rate_percent),
    hasSignedFile: !!signed?.signed_file_key,
    hasSignedExhibit: !!signed?.signed_exhibit_file_key,
    liveVersionLabel: liveVersion?.label ?? null,
    canSign: !valid && signingAvailable && !!liveVersion?.provider_template_id && !!liveVersion?.provider_recipient_id,
    declinedAt: declined,
    covered: coveredList,
    // Live properties not fully covered: not on Exhibit A, or with units on it missing.
    uncoveredLive: properties
      .filter((p) => p.live && !coversProperty(p, covered.get(p.listingId)))
      .map((p) => ({ listingId: p.listingId, address: p.address, missingUnits: covered.has(p.listingId) ? missingUnits(p, covered.get(p.listingId)) : [] })),
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

/*
 * The signer's full name, first and last, as it goes on the document (Documenso's
 * Name box and any "Name" text box). At least two words.
 */
export function cleanSignerName(name) {
  const n = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!n) throw new BillingError("name_required", "Enter your full name, first and last.");
  if (n.length > SIGNER_NAME_MAX) throw new BillingError("name_too_long", `Keep your name under ${SIGNER_NAME_MAX} characters.`);
  if (n.split(" ").length < 2) throw new BillingError("full_name_required", "Enter your first and last name.");
  return n;
}

// The company the landlord signs for, from the form: optional, at most 150 characters.
export function cleanSignerCompany(company) {
  const c = String(company ?? "").trim().replace(/\s+/g, " ");
  if (c.length > 150) throw new BillingError("company_too_long", "Keep the company name under 150 characters.");
  return c;
}

const oneLine = (v, max, code, what) => {
  const t = String(v ?? "").trim().replace(/\s+/g, " ");
  if (t.length > max) throw new BillingError(code, `Keep ${what} under ${max} characters.`);
  return t;
};

/*
 * The optional details from the signing form: company, email, and the address as
 * the street (picked from the address search), the suite or unit, and the city
 * line ("St. Louis, MO 63117") that came with the street. On the document
 * (Wyatt, 2026-11-07): "Address 1" is the street and suite on one line, "Address 2"
 * the city line, as a letter's address reads:
 *     8151 Clayton Rd, Suite 301
 *     St. Louis, MO 63117
 */
export function cleanSignerDetails({ company, email, address1, address2, city } = {}) {
  const e = oneLine(email, 254, "email_too_long", "the email");
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new BillingError("bad_email", "Enter a valid email address.");
  return {
    company: cleanSignerCompany(company),
    email: e,
    street: oneLine(address1, 150, "address_too_long", "the address"),
    suite: oneLine(address2, 60, "address_too_long", "the suite or unit"),
    city: oneLine(city, 150, "address_too_long", "the address"),
  };
}

// The text each kind of box gets from the form (the ones a changed form must remake).
// The two address lines a document prints.
export const addressLines = ({ street = "", suite = "", city = "" } = {}) => ({
  line1: [street, suite].filter(Boolean).join(", "),
  line2: city,
});

const boxValues = ({ name, company, email, street, suite, city }) => ({
  company,
  owner: company || name,
  email,
  address1: addressLines({ street, suite, city }).line1,
  address2: addressLines({ street, suite, city }).line2,
});

// Whether a copy's boxes still hold what the form says now (matched to the template's boxes by place).
function copyBoxesMatch(templateEnvelope, copyEnvelope, values) {
  const boxes = copyBoxesByKind(templateEnvelope, copyEnvelope);
  return Object.entries(values).every(([kind, value]) => (boxes[kind] ?? []).every((f) => String(f.fieldMeta?.text ?? "") === (value ?? "")));
}

// The popup's Exhibit A choices ([{ listingId, include, wholeBuilding, units }]) as a Map, or null.
function exhibitSelections(list) {
  if (!Array.isArray(list)) return null;
  const out = new Map();
  for (const s of list.slice(0, 500)) {
    if (!s || typeof s.listingId !== "string") continue;
    out.set(s.listingId, {
      include: s.include !== false,
      ...(s.excluded === true && { excluded: true }),
      ...(typeof s.wholeBuilding === "boolean" && { wholeBuilding: s.wholeBuilding }),
      ...(Array.isArray(s.units) && { units: s.units.filter((u) => typeof u === "string").map((u) => u.trim()).filter(Boolean).slice(0, 200) }),
    });
  }
  return out;
}

// What one Exhibit A entry covers, as the document says it: "Whole building" or "Units: 1A, 1B".
export const coverageLine = (e) => (e.wholeBuilding !== false || !e.units?.length ? "Whole building" : `Units: ${e.units.join(", ")}`);

/*
 * The covered properties as the "Exhibit A" box shows them (Wyatt, 2026-11-07):
 * each property's full address, then "Whole building" or its units on the next
 * line, a blank line between properties. `added` marks what an amendment adds.
 */
export function exhibitText(entries, { added = null } = {}) {
  if (!entries.length) return "None.";
  return entries
    .map((e) => `${e.address}${added?.has(e.listingId) ? " (added by this amendment)" : ""}\n${coverageLine(e)}`)
    .join("\n\n");
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

// The same Exhibit A: the same properties, each with the same building or units choice.
const entryKey = (e) => `${e.listingId}|${e.wholeBuilding !== false ? "whole" : [...(e.units ?? [])].sort().join(",")}`;
const sameIds = (a, b) => {
  const x = new Set(a.map(entryKey));
  return x.size === b.length && b.every((e) => x.has(entryKey(e)));
};

/*
 * Start (or resume) signing for this landlord and return what the embed needs:
 * { token, kind } for Documenso's signing page, or { alreadySigned: true } when
 * everything asked for is already covered. With `prepare: true` the copy is only
 * made ready (a Documenso draft) and { prepared: true, kind } comes back: the
 * Payments tab and the publish dialog call it while the landlord answers the
 * license questions, then call again with the answer, which fills the licensee
 * boxes on the draft and opens it at once.
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
  {
    user,
    signerTitle,
    signerName,
    signerCompany,
    signerEmail,
    signerAddress1,
    signerAddress2,
    signerCity,
    authorized,
    listingIds = [],
    exhibit = null,
    now = new Date(),
    storeExhibit,
    landlordAddress,
    prepare = false,
    fromAgreement = false,
    ...options
  }
) {
  // An Addendum to Exhibit A signed with the details saved on the agreement
  // (`fromAgreement`, Wyatt 2026-11-07): name, title, company, email and address
  // are not asked again; they are read from the agreement below.
  if (!fromAgreement && authorized !== true) {
    throw new BillingError("authorization_required", "Confirm that you are authorised to sign for this landlord or company.");
  }
  let title = fromAgreement ? null : cleanSignerTitle(signerTitle);
  // Older clients send no name: the account name, which may be one word.
  let name = fromAgreement ? null : signerName === undefined ? String(user?.name ?? "").trim() || user?.email : cleanSignerName(signerName);
  // What the landlord typed on the form (pre-filled with what we know), for the boxes.
  let details = fromAgreement ? null : cleanSignerDetails({ company: signerCompany, email: signerEmail, address1: signerAddress1, address2: signerAddress2, city: signerCity });
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
        // The landlord's Exhibit A choices from the signing popup, per property.
        selections: exhibitSelections(exhibit),
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
        const what = plan.kind === "amendment" ? "The Exhibit A amendment" : "The marketing agreement";
        throw new BillingError("not_available", `${what} is not ready to sign yet. We will email you when it is.`, 409);
      }

      // An addendum with the agreement's saved details; anything else, or an
      // agreement signed before details were saved, asks for them on the popup.
      if (fromAgreement) {
        const saved = plan.kind === "amendment" ? state.signed : null;
        if (!saved?.signer_details || !saved.signer_name) {
          throw new BillingError("details_required", "Confirm your details to sign.", 409);
        }
        const d = saved.signer_details;
        name = saved.signer_name;
        title = saved.signer_title ?? "";
        details = cleanSignerDetails({ company: d.company, email: d.email, address1: d.street, address2: d.suite, city: d.city });
      }

      // Reuse the copy in progress when it is exactly this document: same version,
      // properties, name and title, and made today (its date box shows today).
      if (inProgress?.row.provider_envelope_id) {
        const same =
          inProgress.kind === plan.kind &&
          inProgress.row.version_id === version.id &&
          sameIds(inProgress.entries, plan.entries) &&
          (inProgress.row.signer_title ?? "") === title &&
          sameDay(inProgress.row.created_at ?? now, now);
        if (same) {
          const envelope = await documenso.getEnvelope(inProgress.row.provider_envelope_id);
          const signer = signerOf(envelope);
          const sameName = (signer?.name ?? "") === name;
          // Changed company, email or address on the form means a fresh copy too.
          const template = await documenso.getEnvelope(version.provider_template_id).catch(() => null);
          const sameCompany = !template || copyBoxesMatch(template, envelope, boxValues({ name, ...details }));
          if (sameName && sameCompany && envelope.status === "DRAFT") {
            const opened = await finishDocument(db, documenso, { kind: plan.kind, row: inProgress.row, now });
            return prepare ? { prepared: true, kind: plan.kind } : opened;
          }
          if (sameName && sameCompany && envelope.status === "PENDING" && signer?.token) {
            if (prepare) return { prepared: true, kind: plan.kind };
            // Opened before: carry on where they left off.
            const { error } = await db
              .from(TABLE[inProgress.kind])
              .update({ signer_title: title, authorized_at: now.toISOString() })
              .eq("id", inProgress.row.id);
            if (error) throw error;
            return { token: signer.token, kind: plan.kind };
          }
          if (!["DRAFT", "PENDING"].includes(envelope.status)) {
            const applied = await applyEnvelope(db, documenso, envelope, { ...options, now });
            if (applied === "signed") return { alreadySigned: true };
          }
        }
      }
      if (inProgress && PENDING.includes((await currentStatus(db, inProgress))?.status)) {
        await cancelInDocumenso(documenso, inProgress.row, "Replaced by a newer copy");
        await endDocument(db, inProgress.kind, inProgress.row, "replaced by a newer copy", now);
      }

      const made = await createDocument(db, documenso, {
        user,
        title,
        name,
        details,
        plan,
        version,
        master: state.signed,
        now,
        storeExhibit,
        landlordAddress,
      });
      // Nothing from the license answer goes on the document (2026-11-06), so it is
      // opened (distributed) straight away, while the landlord answers; the call
      // with their answer then only hands back the signing token.
      const opened = await finishDocument(db, documenso, { kind: plan.kind, row: made.row, now });
      return prepare ? { prepared: true, kind: plan.kind } : opened;
    }
  );
}

/*
 * Open a prepared copy: distribute it, which issues the signing token. The
 * license answer given in the popup is saved to the account, never printed on the
 * agreement (Wyatt, 2026-11-06): its wording says they provide it when asked.
 */
async function finishDocument(db, documenso, { kind, row, now }) {
  const { token } = await documenso.finishSigningCopy({ envelopeId: row.provider_envelope_id });
  const { error } = await db.from(TABLE[kind]).update({ authorized_at: now.toISOString() }).eq("id", row.id);
  if (error) throw error;
  return { token, kind };
}

async function currentStatus(db, doc) {
  const { data, error } = await db.from(TABLE[doc.kind]).select("id, status").eq("id", doc.row.id).maybeSingle();
  if (error) throw error;
  return data;
}

// Withdraw a copy in Documenso, best effort: cancelled if it was opened, deleted if still a draft.
async function cancelInDocumenso(documenso, row, reason) {
  if (!row?.provider_envelope_id) return;
  const withdraw = documenso.discard ? documenso.discard.bind(documenso) : documenso.cancel.bind(documenso);
  await withdraw(row.provider_envelope_id, reason).catch(() => {});
}


// Make the record, its proposed coverage, the Exhibit A and the Documenso copy.
/*
 * The boxes to fill on this version's template, read from Documenso now (so a box
 * the admin moved, or a Number box for the rate, is filled correctly), falling back
 * to the ids saved when the version was checked.
 */
// The ids of every box of one kind: all of them when the template was read, else the one saved.
const idsOf = (boxes, kind) => {
  const all = boxes.allIds?.[kind];
  if (all?.length) return all;
  return boxes[kind]?.id ? [boxes[kind].id] : [];
};

async function templateBoxes(documenso, version) {
  const saved = {
    title: version.provider_title_field_id ? { id: version.provider_title_field_id, type: "text" } : null,
    rate: version.provider_rate_field_id ? { id: version.provider_rate_field_id, type: "text" } : null,
    address: version.provider_address_field_id ? { id: version.provider_address_field_id, type: "text" } : null,
    name: null,
    company: null,
    owner: null,
    brokerage: version.provider_brokerage_field_id ? { id: version.provider_brokerage_field_id, type: "text" } : null,
    license: version.provider_license_field_id ? { id: version.provider_license_field_id, type: "text" } : null,
  };
  try {
    const summary = templateFieldSummary(await documenso.getEnvelope(version.provider_template_id));
    const live = summary?.fields;
    if (!live) return saved;
    return {
      allIds: summary.allIds,
      exhibitBoxes: summary.exhibitBoxes,
      title: live.title ?? saved.title,
      rate: live.rate ?? saved.rate,
      address: live.address ?? saved.address,
      name: live.name,
      company: live.company,
      owner: live.owner,
      brokerage: live.brokerage ?? saved.brokerage,
      license: live.license ?? saved.license,
    };
  } catch {
    return saved;
  }
}


async function createDocument(db, documenso, { user, title, name, details = {}, plan, version, master, now, storeExhibit, landlordAddress }) {
  const company = details.company ?? "";
  const savedDetails = { company, email: details.email ?? "", street: details.street ?? "", suite: details.suite ?? "", city: details.city ?? "" };
  const nowIso = now.toISOString();
  const isAmendment = plan.kind === "amendment";

  // The record first, so a Documenso copy is never made without one to find it by.
  const fields = isAmendment
    ? {
        user_id: user.id,
        agreement_id: master.id,
        version_id: version.id,
        status: "sent",
        // The day its date boxes were filled: reuse only on the same day.
        created_at: nowIso,
        previous_exhibit: plan.previous,
        proposed_exhibit: plan.entries,
        signer_title: title,
        authorized_at: nowIso,
        signer_details: savedDetails,
      }
    : {
        user_id: user.id,
        status: "sent",
        created_at: nowIso,
        version: version.label,
        version_id: version.id,
        provider: "documenso",
        signer_title: title,
        authorized_at: nowIso,
        // Kept so an Addendum to Exhibit A fills the same signature block (2026-11-07).
        signer_details: savedDetails,
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
        units: e.wholeBuilding !== false ? [] : e.units ?? [],
        whole_building: e.wholeBuilding !== false,
        agreement_id: isAmendment ? master.id : row.id,
        amendment_id: isAmendment ? row.id : null,
        status: "proposed",
      }))
    );
    if (covError) throw covError;
  }

  const externalId = `${isAmendment ? "agreement-amendment" : "landlord-agreement"}:${row.id}`;
  const boxes = await templateBoxes(documenso, version);

  // Exhibit A is the document's own "Exhibit A" Text box, at its end: every
  // envelope is one document (Wyatt, 2026-11-06). It lists every covered property,
  // one per line. On an amendment it is the list after it, the added properties
  // marked; the list before goes in an "Exhibit A before" box, or, without one,
  // above it in the same box. A version cannot go live without the box
  // (templateFieldSummary), so one without it is not offered for signing.
  if (!idsOf(boxes, "exhibit").length) {
    console.error(`billing: version ${version.id} has no "Exhibit A" box; not offering it for signing`);
    const what = isAmendment ? "The Exhibit A amendment" : "The marketing agreement";
    throw new BillingError("not_available", `${what} is not ready to sign yet. We will email you when it is.`, 409);
  }
  // An Addendum to Exhibit A lists only what it adds (Wyatt, 2026-11-07): new
  // properties, and for a property already on it only the units being added.
  const previousBy = new Map((plan.previous ?? []).map((e) => [e.listingId, e]));
  const addedOnly = (plan.added ?? []).map((e) => {
    const was = previousBy.get(e.listingId);
    if (!was || e.wholeBuilding !== false) return e;
    return { ...e, units: (e.units ?? []).filter((u) => !(was.units ?? []).includes(u)) };
  });
  // One block per property; spread over the Exhibit A boxes in order, and what does
  // not fit goes on generated "Exhibit A (continued)" pages attached to the copy (fitExhibit).
  const exhibitEntries = isAmendment ? addedOnly : plan.entries;
  const exhibitBlocks = exhibitEntries.map((e) => `${e.address}\n${coverageLine(e)}`);
  const exhibitBoxList = boxes.exhibitBoxes?.length ? boxes.exhibitBoxes : idsOf(boxes, "exhibit").map((id) => ({ id, height: 100 }));
  const exhibitBeforeText = exhibitText(plan.previous ?? []);
  const fitted = fitExhibit(exhibitBlocks, exhibitBoxList);
  const continued = fitted.rest.length
    ? await buildExhibitPdf({
        kind: "continued",
        heading: isAmendment ? "ADDENDUM TO EXHIBIT A (CONTINUED)" : "EXHIBIT A (CONTINUED)",
        landlordName: details.company || name,
        blocks: fitted.rest,
        preparedAt: now,
      })
    : null;
  // The address as typed on the form; without one, the Stripe billing address.
  const { line1, line2 } = addressLines(details);
  const typedAddress = [line1, line2].filter(Boolean).join(", ");
  const address = typedAddress || (landlordAddress ? await landlordAddress(user.id).catch(() => null) : null);
  const values = boxValues({ name, ...details });
  const copy = await documenso.prepareSigningCopy({
    templateId: version.provider_template_id,
    recipientId: version.provider_recipient_id,
    titleFieldId: boxes.title?.id ?? null,
    signerTitle: title,
    // The commission rate is written into the agreement's text (Wyatt, 2026-11-05), so no box is filled for it.
    // Every box of each kind gets its value (a template may repeat one).
    prefill: [
      ...idsOf(boxes, "title").filter((id) => id !== boxes.title?.id).map((id) => ({ id, value: title })),
      ...idsOf(boxes, "address").map((id) => ({ id, value: address })),
      ...idsOf(boxes, "name").map((id) => ({ id, value: name })),
      ...["company", "owner", "email", "address1", "address2"].flatMap((k) => idsOf(boxes, k).map((id) => ({ id, value: values[k] }))),
      ...fitted.fill,
      ...idsOf(boxes, "exhibitBefore").map((id) => ({ id, value: exhibitBeforeText })),
      // The agreement's own date ("Effective Date"): an addendum's agreement, or today on the agreement itself.
      ...idsOf(boxes, "agreementDate").map((id) => ({ id, value: fmtDate(isAmendment ? master?.signed_at ?? now : now) })),
    ],
    // Documenso's own Name, Email and Date boxes, filled so only the signature and initials are left.
    autofill: { name, email: details.email || user.email, date: fmtDate(now) },
    // A commission rate box left on an older template is taken off the copy.
    dropRateBox: true,
    exhibit: continued
      ? { bytes: continued.bytes, pageCount: continued.pageCount, initialsBox: INITIALS_BOX, fileName: isAmendment ? "addendum-exhibit-a-continued.pdf" : "exhibit-a-continued.pdf" }
      : null,
    email: user.email,
    name,
    title: isAmendment ? "Exhibit A amendment" : "Marketing agreement",
    externalId,
  });
  const saved = {
    provider_envelope_id: copy.envelopeId,
    ...(copy.exhibitItemId && { provider_exhibit_item_id: copy.exhibitItemId }),
  };
  const { error: saveError } = await db.from(TABLE[plan.kind]).update(saved).eq("id", row.id);
  if (saveError) throw saveError;
  return { row: { id: row.id, ...saved }, kind: plan.kind };
}

// Which of our documents a Documenso envelope is: { kind, row } or null.
async function findDocument(db, envelopeId) {
  for (const kind of ["master", "amendment"]) {
    const { data, error } = await db
      .from(TABLE[kind])
      .select(kind === "amendment" ? "id, user_id, status, version_id, agreement_id" : "id, user_id, status, version_id")
      .eq("provider_envelope_id", envelopeId)
      .maybeSingle();
    // Only a table that does not exist yet is skipped; any other error is real.
    if (error && ["PGRST205", "42P01"].includes(error.code)) continue;
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
      ...(kind === "master" && { term_start: signedAt }),
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
  const exhibit = properties
    .filter((p) => p.live)
    .map((p) => ({ listingId: p.listingId, address: p.address, ...exhibitChoice(p, null, { locked: true }) }));
  const fields = {
    status: "signed",
    signed_at: when.toISOString(),
    signer_name: name,
    term_start: when.toISOString(),
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
        units: e.wholeBuilding !== false ? [] : e.units,
        whole_building: e.wholeBuilding !== false,
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
/*
 * Void one of a landlord's documents from the admin dashboard: a master agreement
 * or an Exhibit A amendment, signed or still being signed.
 *   - A copy still being signed is cancelled in Documenso too, and the properties
 *     it proposed are released.
 *   - A signed one stops counting, and the properties it covered are released (a
 *     master: everything on its Exhibit A, including what amendments added; an
 *     amendment: only what it added). An amendment still being signed on a voided
 *     master is cancelled too. The signed PDFs are kept.
 * Returns { id, kind, status: "voided", released } (properties released).
 */
export async function voidDocument(db, documenso, { userId, kind, id, now = new Date() }) {
  if (!TABLE[kind]) throw new BillingError("bad_kind", "Choose the agreement or an amendment.");
  const { data: row, error } = await db
    .from(TABLE[kind])
    .select("id, user_id, status, provider_envelope_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new BillingError("not_found", "That document was not found.", 404);
  if (row.status !== "signed" && !PENDING.includes(row.status)) {
    throw new BillingError("already_ended", "That document has already ended.", 409);
  }
  const nowIso = now.toISOString();
  const reason = "voided by an admin";

  if (row.status !== "signed") {
    if (documenso) await cancelInDocumenso(documenso, row, "Voided by Proximity");
    await endDocument(db, kind, row, reason, now);
    return { id: row.id, kind, status: "voided", released: 0 };
  }

  if (kind === "master") {
    const { data: pending, error: pendingError } = await db
      .from("agreement_amendments")
      .select("id, status, provider_envelope_id")
      .eq("agreement_id", row.id)
      .in("status", PENDING);
    if (pendingError && !missingSchema(pendingError)) throw pendingError;
    for (const a of pending ?? []) {
      if (documenso) await cancelInDocumenso(documenso, a, "Voided by Proximity");
      await endDocument(db, "amendment", a, "its agreement was voided", now);
    }
  }

  const { data: ended, error: endError } = await db
    .from(TABLE[kind])
    .update({ status: "voided", ended_reason: reason, ended_at: nowIso })
    .eq("id", row.id)
    .eq("status", "signed")
    .select("id");
  if (endError) throw endError;
  if (!ended?.length) throw new BillingError("status_changed", "That document just changed. Reload and try again.", 409);

  let release = db
    .from("agreement_coverage")
    .update({ status: "released", released_at: nowIso })
    .in("status", ["proposed", "covered"]);
  release = kind === "master" ? release.eq("agreement_id", row.id) : release.eq("amendment_id", row.id);
  const { data: released, error: releaseError } = await release.select("id");
  if (releaseError && !missingSchema(releaseError)) throw releaseError;
  return { id: row.id, kind, status: "voided", released: released?.length ?? 0 };
}

export async function voidAgreement(db, documenso, { userId }) {
  const state = await agreementState(db, userId);
  if (state.pendingAmendment) {
    if (documenso) await cancelInDocumenso(documenso, state.pendingAmendment, "Voided by Proximity");
    await endDocument(db, "amendment", state.pendingAmendment, "voided by an admin");
    return { id: state.pendingAmendment.id, status: "voided", kind: "amendment" };
  }
  const target = state.pending ?? state.signed;
  if (!target) throw new BillingError("not_found", "This landlord has no agreement to void.", 404);
  // A signed agreement also releases what it covered.
  if (target.status === "signed") return voidDocument(db, documenso, { userId, kind: "master", id: target.id });
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
 * A signed document as people see it: one PDF made of its stored parts, in order
 * (the agreement or amendment wording, then its Exhibit A pages). Returns the
 * keys, checked to be this landlord's; empty when nothing is on file. Without an
 * id, their current master.
 */
export async function documentFileKeys(db, { userId, kind = "master", id = null }) {
  if (!TABLE[kind]) return [];
  let q = db.from(TABLE[kind]).select("id, user_id, status, signed_file_key, signed_exhibit_file_key").eq("user_id", userId);
  q = id ? q.eq("id", id) : q.eq("status", "signed");
  const { data, error } = await q.limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? [row.signed_file_key, row.signed_exhibit_file_key].filter(Boolean) : [];
}

/*
 * The same document's parts with what is needed to put Documenso's signing
 * certificates at the end: each signed part, and the unsigned original it was
 * made from (the uploaded version PDF, the generated Exhibit A pages), whose page
 * count says where the document ends and its certificate begins. Opened, the
 * document reads: the agreement, Exhibit A last, then the certificates
 * (Wyatt, 2026-11-06).
 */
export async function documentParts(db, { userId, kind = "master", id = null }) {
  if (!TABLE[kind]) return [];
  let q = db
    .from(TABLE[kind])
    .select("id, user_id, status, version_id, signed_file_key, signed_exhibit_file_key, exhibit_file_key")
    .eq("user_id", userId);
  q = id ? q.eq("id", id) : q.eq("status", "signed");
  const { data, error } = await q.limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return [];
  let versionKey = null;
  if (row.version_id) {
    const { data: v } = await db.from("agreement_versions").select("file_key").eq("id", row.version_id).maybeSingle();
    versionKey = v?.file_key ?? null;
  }
  return [
    row.signed_file_key && { key: row.signed_file_key, originalKey: versionKey },
    row.signed_exhibit_file_key && { key: row.signed_exhibit_file_key, originalKey: row.exhibit_file_key ?? null },
  ].filter(Boolean);
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
