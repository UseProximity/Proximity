/*
 * A landlord's marketing agreement signed on paper (Wyatt, 2026-11-17).
 *
 *   paperPreview          the admin's property picker: the same Exhibit A step a
 *                         landlord sees when signing in the app, plus the company
 *   printPaperAgreement   records the agreement as out on paper (a master with
 *                         status sent, provider "paper") with the chosen properties
 *                         proposed. While it is out those properties are held: an
 *                         unsigned document never covers anything, so their drafts
 *                         cannot go live, and nobody can start another copy (in the
 *                         app or on paper) until it is recorded or voided. Live
 *                         listings stay live.
 *   paperAgreementPdf     the printable PDF (paperAgreementPdf.js), made again from
 *                         the record each time, so it can be printed more than once
 *   recordPreview         the confirm step: the picker with what was printed ticked
 *   recordPaperAgreement  the signed copy is back: the admin uploads it (required)
 *                         and confirms the properties on it, changing the list to
 *                         match the paper. Those become covered. Live listings left
 *                         off come off the site, as when signing in the app.
 *   publishCovered        the drafts the admin ticked go live
 *
 * Voiding uses voidDocument (agreements.js), which releases the hold.
 * Only a main agreement: a landlord who already signed adds properties with the
 * in-app addendum.
 *
 * A landlord account with an authorized signer (billing_payers): the paper
 * agreement is the SIGNER's, covering this account's properties, exactly as when
 * the signer signs in the app (Wyatt, 2026-11-17). The record belongs to the
 * signer (`holderId`); the coverage rows to the landlord account.
 *
 * `db` is a service-role Supabase client.
 */
import { BillingError } from "./errors.js";
import { withSettingsLock } from "./settings.js";
import { getLiveVersion } from "./agreementVersions.js";
import { activePayerLink } from "./payerLinks.js";
import { PAPER, PAPER_OUT_MESSAGE, agreementState, assertNoPaperOut, coverageFor, coverageLine, endDocument, exhibitSelections, isPaperOut, releaseProposed } from "./agreements.js";
import { planCoverage, withdrawOfferings, withdrawUnitLeases } from "./coverage.js";
import { exhibitPreview } from "./exhibitUnits.js";
import { signerOf } from "./documenso.js";
import { buildPaperAgreementPdf } from "./paperAgreementPdf.js";
import { fmtDate } from "./exhibitPdf.js";

export { PAPER, PAPER_OUT_MESSAGE, isPaperOut, assertNoPaperOut };

const COMPANY_MAX = 120;
const SIGNER_MAX = 100;

const cleanCompany = (c) => String(c ?? "").trim().replace(/\s+/g, " ").slice(0, COMPANY_MAX);

// Why this landlord can't have a paper copy printed now, or null. `state` is the
// holder's (agreementState): the authorized signer's when the account has one.
function cannotPrint(state) {
  const signer = state.payerLink?.signer_name;
  if (state.valid && !state.negotiatedOffer) {
    return signer
      ? `${signer}'s agreement is already signed. This account's properties are added with the Exhibit A addendum in the app.`
      : "This landlord already has a signed agreement. New properties are added with the Exhibit A addendum in the app.";
  }
  // A signer's agreement that needs signing again may cover other accounts too:
  // replacing it is done in the app, where every account is carried over.
  if (state.payerLink && state.signed) return `${signer} has an agreement that needs signing again. They sign the new one in the app.`;
  if (isPaperOut(state)) {
    return `A paper copy is already out (printed ${fmtDate(state.pending.created_at)}). Void it first to print a new one.`;
  }
  if (state.pending) {
    return signer
      ? `${signer} has started signing in the app. Void that copy first to print a paper one.`
      : "This landlord has started signing in the app. Void that copy first to print a paper one.";
  }
  return null;
}

async function liveMasterVersion(db, landlordId) {
  const version = await getLiveVersion(db, { kind: "master", landlordId });
  if (!version?.file_key) throw new BillingError("not_available", "No marketing agreement version is live yet.", 409);
  return version;
}

// The company last given on one of their agreements, to start the field with.
async function lastCompany(db, landlordId) {
  const { data, error } = await db
    .from("landlord_agreements")
    .select("signer_details")
    .eq("user_id", landlordId)
    .not("signer_details", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return "";
  return cleanCompany(data?.[0]?.signer_details?.company);
}

export async function paperPreview(db, landlordId, now = new Date()) {
  const state = await agreementState(db, landlordId, now);
  const reason = cannotPrint(state);
  if (reason) throw new BillingError("cannot_print", reason, 409);
  const version = await liveMasterVersion(db, state.holderId);
  // A signer may leave off anything of the account's not covered yet, drafts included (Project B).
  const preview = await exhibitPreview(db, landlordId, { now, forPayee: !!state.payerLink });
  return {
    properties: preview.kind === "none" ? [] : preview.properties,
    company: (await lastCompany(db, state.holderId)) || (state.payerLink ? "" : await lastCompany(db, landlordId)),
    versionLabel: version.label,
    negotiated: !!version.landlord_id,
    signer: state.payerLink ? { name: state.payerLink.signer_name } : null,
  };
}

// The Exhibit A plan for a main agreement with these choices.
async function planMaster(db, landlordId, exhibit, now, { requestedExcludable = false } = {}) {
  const loaded = await coverageFor(db, landlordId, now);
  const { state } = loaded;
  const plan = planCoverage({
    properties: loaded.properties,
    rows: loaded.rows,
    master: state.signed,
    masterValid: state.valid && !state.negotiatedOffer,
    requestedIds: [],
    carry: [],
    selections: exhibitSelections(exhibit),
    requestedExcludable,
  });
  if (plan.kind !== "master") throw new BillingError("cannot_print", "This landlord already has a signed agreement.", 409);
  if (!plan.entries.length) throw new BillingError("no_properties", "Choose at least one property for Exhibit A.");
  return { plan, state };
}

const coverageRows = (landlordId, agreementId, entries, extra) =>
  entries.map((e) => ({
    user_id: landlordId,
    listing_id: e.listingId,
    address: e.address,
    units: e.wholeBuilding !== false ? [] : e.units ?? [],
    unit_ids: e.wholeBuilding !== false || !e.unitIds?.length ? null : e.unitIds,
    whole_building: e.wholeBuilding !== false,
    agreement_id: agreementId,
    ...extra,
  }));

/*
 * Put a paper agreement out for this landlord. Returns { id }. Holds the same
 * lock as signing in the app, so the landlord can't start a copy at the same moment.
 */
export async function printPaperAgreement(db, { landlordId, exhibit, company, now = new Date() }) {
  // The lock in-app signing takes is the signer's: the holder's.
  const holderId = (await activePayerLink(db, landlordId))?.payer_id ?? landlordId;
  return withSettingsLock(
    db,
    { key: `agreement_sign:${holderId}`, staleMs: 2 * 60 * 1000, now, busyMessage: "This landlord's agreement is being prepared. Try again in a moment." },
    async () => {
      const state = await agreementState(db, landlordId, now);
      const reason = cannotPrint(state);
      if (reason) throw new BillingError("cannot_print", reason, 409);
      if (state.holderId !== holderId) throw new BillingError("status_changed", "This landlord's authorized signer just changed. Reload and try again.", 409);
      const version = await liveMasterVersion(db, holderId);
      const { plan } = await planMaster(db, landlordId, exhibit, now, { requestedExcludable: !!state.payerLink });
      const { data: row, error } = await db
        .from("landlord_agreements")
        .insert({
          user_id: holderId,
          status: "sent",
          provider: PAPER,
          version: version.label,
          version_id: version.id,
          created_at: now.toISOString(),
          exhibit: plan.entries,
          commission_rate_percent: version.commission_rate_percent ?? null,
          signer_details: { company: cleanCompany(company), email: "", street: "", suite: "", city: "" },
          withdraw_on_sign: plan.withdraw ?? [],
          withdraw_unit_ids_on_sign: plan.withdrawUnits ?? [],
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") throw new BillingError("status_changed", "This landlord's agreement just changed. Reload and try again.", 409);
        throw error;
      }
      const { error: covError } = await db.from("agreement_coverage").insert(coverageRows(landlordId, row.id, plan.entries, { status: "proposed" }));
      if (covError) {
        // Never leave a record out on paper with nothing held.
        await db.from("landlord_agreements").update({ status: "voided", ended_reason: "could not record its properties", ended_at: now.toISOString() }).eq("id", row.id);
        throw covError;
      }
      return { id: row.id };
    }
  );
}

// A paper agreement of this landlord account: their own, or their signer's
// covering their properties (its coverage rows are the account's).
async function paperRow(db, landlordId, id) {
  const { data, error } = await db
    .from("landlord_agreements")
    .select("id, user_id, status, provider, version_id, exhibit, signer_details, created_at, agreement_version:agreement_versions!version_id(id, label, file_key, provider_template_id)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.provider !== PAPER) throw new BillingError("not_found", "That paper agreement was not found.", 404);
  if (data.user_id !== landlordId) {
    const { data: rows, error: covError } = await db.from("agreement_coverage").select("id").eq("agreement_id", id).eq("user_id", landlordId).limit(1);
    if (covError) throw covError;
    if (!rows?.length) throw new BillingError("not_found", "That paper agreement was not found.", 404);
  }
  return data;
}

/*
 * The printable PDF for a paper agreement still out. `readFile(key)` reads the
 * version's PDF; `documenso` (optional) gives a hand-placed template's boxes.
 */
export async function paperAgreementPdf(db, { landlordId, id, readFile, documenso = null }) {
  const row = await paperRow(db, landlordId, id);
  if (row.status !== "sent") throw new BillingError("not_out", "That paper agreement is no longer out. Print a new one to change it.", 409);
  const version = row.agreement_version;
  if (!version?.file_key) throw new BillingError("not_available", "That agreement version's PDF is missing.", 409);
  let templateFields = null;
  if (documenso && version.provider_template_id) {
    try {
      const envelope = await documenso.getEnvelope(version.provider_template_id);
      const signer = signerOf(envelope);
      templateFields = (envelope?.fields ?? []).filter((f) => !signer || f.recipientId === signer.id);
    } catch {
      templateFields = null;
    }
  }
  const { data: landlord } = await db.from("users").select("name").eq("id", landlordId).maybeSingle();
  const entries = Array.isArray(row.exhibit) ? row.exhibit : [];
  return buildPaperAgreementPdf({
    versionBytes: await readFile(version.file_key),
    templateFields,
    blocks: entries.map((e) => `${e.address}\n${coverageLine(e)}`),
    company: row.signer_details?.company ?? "",
    landlordName: landlord?.name ?? "",
    preparedAt: new Date(row.created_at),
  });
}

/*
 * Draft listings the landlord could publish once covered: their own draft
 * properties with a priced unit, and live properties with draft offerings of theirs.
 * Returns Map listingId -> { ready, reason }.
 */
export async function publishable(db, landlordId, listingIds) {
  const out = new Map();
  if (!listingIds.length) return out;
  const { data: owned, error } = await db.from("listing_landlords").select("listing_id").eq("user_id", landlordId).in("listing_id", listingIds);
  if (error) throw error;
  const ownedIds = new Set((owned ?? []).map((r) => r.listing_id));
  const { data: listings, error: listError } = await db
    .from("listings")
    .select("id, published_at, deleted_at, listing_units(id, published_at, deleted_at, unit_leases(owner_id, rent, published_at, deleted_at))")
    .in("id", listingIds);
  if (listError) throw listError;
  for (const l of listings ?? []) {
    if (l.deleted_at || !ownedIds.has(l.id)) continue;
    const units = (l.listing_units ?? []).filter((u) => !u.deleted_at);
    const leases = units.flatMap((u) => (u.unit_leases ?? []).filter((x) => !x.deleted_at));
    if (l.published_at === null) {
      const ready = leases.some((x) => x.rent != null);
      out.set(l.id, { ready, reason: ready ? null : "No unit with a price yet, so it stays a draft." });
    } else if (leases.some((x) => x.owner_id === landlordId && x.published_at === null)) {
      out.set(l.id, { ready: true, reason: null });
    }
  }
  return out;
}

// The confirm step: the picker with what was printed ticked, and which drafts can go live.
export async function recordPreview(db, landlordId, id, now = new Date()) {
  const row = await paperRow(db, landlordId, id);
  if (row.status !== "sent") throw new BillingError("not_out", "That paper agreement is no longer out.", 409);
  const forPayee = row.user_id !== landlordId;
  const preview = await exhibitPreview(db, landlordId, { now, paper: true, forPayee });
  const printed = new Map((row.exhibit ?? []).map((e) => [e.listingId, e]));
  const properties = (preview.kind === "none" ? [] : preview.properties).map((p) => {
    const e = printed.get(p.listingId);
    return {
      ...p,
      // Anything can be crossed off on paper: a live one then comes off the site.
      canExclude: true,
      // Nothing is being published here: a draft reads as a draft.
      locked: p.live,
      onPrinted: !!e,
      choice: e
        ? { ...p.choice, include: true, wholeBuilding: e.wholeBuilding !== false, units: e.wholeBuilding !== false ? [] : e.units ?? [] }
        : { ...p.choice, include: false },
    };
  });
  const drafts = await publishable(db, landlordId, properties.map((p) => p.listingId));
  return {
    signer: forPayee ? { name: (await agreementState(db, landlordId, now)).payerLink?.signer_name ?? null } : null,
    printedAt: row.created_at,
    versionLabel: row.agreement_version?.label ?? null,
    company: row.signer_details?.company ?? "",
    properties: properties.map((p) => ({ ...p, publish: drafts.get(p.listingId) ?? null })),
  };
}

/*
 * The signed copy is back. `exhibit` is the confirmed list (the picker's choices),
 * `signedFileKey` the stored upload. Returns { id, covered: [listingId], withdrawn: [listingId] }.
 */
export async function recordPaperAgreement(db, { landlordId, id, exhibit, signerName, signerTitle = null, signedAt = new Date(), signedFileKey, now = new Date() }) {
  const name = String(signerName ?? "").trim().slice(0, SIGNER_MAX);
  if (!name) throw new BillingError("signer_required", "Who signed the agreement?");
  if (!signedFileKey) throw new BillingError("file_required", "Upload the signed copy.");
  const when = new Date(signedAt);
  if (Number.isNaN(when.getTime())) throw new BillingError("bad_date", "That is not a valid signing date.");
  if (when.getTime() > now.getTime() + 24 * 60 * 60 * 1000) throw new BillingError("bad_date", "The signing date cannot be in the future.");
  const row = await paperRow(db, landlordId, id);
  if (row.status !== "sent") throw new BillingError("not_out", "That paper agreement is no longer out.", 409);

  const forPayee = row.user_id !== landlordId;
  return withSettingsLock(
    db,
    { key: `agreement_sign:${row.user_id}`, staleMs: 2 * 60 * 1000, now, busyMessage: "This landlord's agreement is being updated. Try again in a moment." },
    async () => {
      const { plan, state } = await planMaster(db, landlordId, exhibit, now, { requestedExcludable: forPayee });
      if (state.holderId !== row.user_id) {
        throw new BillingError("status_changed", "This landlord's authorized signer changed since it was printed. Void the paper copy and print a new one.", 409);
      }
      const whenIso = when.toISOString();
      const nowIso = now.toISOString();

      // One current signature: an older one (needing a re-sign) steps aside.
      if (state.signed && state.signed.id !== row.id) {
        const { error } = await db
          .from("landlord_agreements")
          .update({ status: "superseded", ended_reason: "replaced by a paper signature", ended_at: nowIso })
          .eq("id", state.signed.id)
          .eq("status", "signed");
        if (error) throw error;
      }
      if (state.pendingAmendment) await endDocument(db, "amendment", state.pendingAmendment, "replaced by a paper signature", now);

      const { data: signed, error: signError } = await db
        .from("landlord_agreements")
        .update({
          status: "signed",
          signed_at: whenIso,
          signer_name: name,
          ...(signerTitle && String(signerTitle).trim() && { signer_title: String(signerTitle).trim().slice(0, SIGNER_MAX) }),
          term_start: whenIso,
          exhibit: plan.entries,
          signed_file_key: signedFileKey,
          withdraw_on_sign: plan.withdraw ?? [],
          withdraw_unit_ids_on_sign: plan.withdrawUnits ?? [],
        })
        .eq("id", row.id)
        .eq("status", "sent")
        .select("id")
        .maybeSingle();
      if (signError) throw signError;
      if (!signed) throw new BillingError("status_changed", "That paper agreement just changed. Reload and try again.", 409);

      // What was printed is replaced by the confirmed list, now covered.
      await releaseProposed(db, "master", row.id, now);
      const { error: covError } = await db.from("agreement_coverage").insert(coverageRows(landlordId, row.id, plan.entries, { status: "covered", covered_at: whenIso }));
      if (covError) throw covError;

      // Live listings left off come off the site, as when signing in the app.
      const withdrawn = [];
      if (plan.withdraw?.length) {
        try {
          await withdrawOfferings(db, landlordId, plan.withdraw);
          withdrawn.push(...plan.withdraw);
        } catch (err) {
          console.error("billing: withdrawing properties left off a paper Exhibit A failed", err?.message);
        }
      }
      if (plan.withdrawUnits?.length) {
        try {
          await withdrawUnitLeases(db, landlordId, plan.withdrawUnits);
        } catch (err) {
          console.error("billing: withdrawing units left off a paper Exhibit A failed", err?.message);
        }
      }
      return { id: row.id, holderId: row.user_id, covered: plan.entries.map((e) => e.listingId), withdrawn };
    }
  );
}

/*
 * Publish the drafts the admin ticked, as the landlord would. Only properties now
 * covered by this agreement. `publishProperty(userId, isSuper, id)` is
 * lib/listings/publish.js's. Returns [{ listingId, ok, error }].
 */
export async function publishCovered(db, { landlordId, agreementId, listingIds, publishProperty }) {
  if (!listingIds?.length) return [];
  const { data, error } = await db
    .from("agreement_coverage")
    .select("listing_id")
    .eq("agreement_id", agreementId)
    .eq("status", "covered")
    .in("listing_id", listingIds);
  if (error) throw error;
  const covered = new Set((data ?? []).map((r) => r.listing_id));
  const out = [];
  for (const listingId of listingIds) {
    if (!covered.has(listingId)) {
      out.push({ listingId, ok: false, error: "Not on the agreement." });
      continue;
    }
    try {
      await publishProperty(landlordId, false, listingId);
      out.push({ listingId, ok: true });
    } catch (err) {
      out.push({ listingId, ok: false, error: err?.message || "Could not publish it." });
    }
  }
  return out;
}
