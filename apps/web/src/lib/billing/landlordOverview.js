/*
 * The admin dashboard's view of every landlord's commission agreement and
 * payment setup, one row each, with whether they can publish right now.
 *
 * Read-only. Everything is loaded in a few batched queries (landlords number in
 * the hundreds), then filtered and searched here.
 *
 *   filter  all | unsigned | needs_resign | in_progress | no_method | blocked | live
 *           | uncovered (live offerings on a property their agreement does not cover)
 *           | review (on a negotiated version a newer standard one asked everyone
 *             to re-sign, or a covered address that has changed since signing)
 *
 * Also: who the "email everyone who hasn't signed" button reaches, and sending
 * the signing email (one landlord or that whole group).
 *
 * `db` is a service-role Supabase client.
 */
import { autopayByLandlord } from "./autopay.js";
import { BillingError } from "./errors.js";
import { AGREEMENT_REQUEST_KIND } from "./constants.js";
import { liveListingOwners } from "./enrollment.js";
import { getLiveVersion, liveLandlordVersions, resignCutoff } from "./agreementVersions.js";
import { isPaperOut, summarizeAgreementRows } from "./agreements.js";
import { coveredMap, displayAddress, unitLabel } from "./coverage.js";
import { describeMethod, effectiveStatus, hasActivePaymentMethod } from "./paymentMethodState.js";
import { gateDecision, getGateSettings } from "./listingGate.js";
import { disclosuresFor } from "../users/licenseDisclosure.js";

const PAGE = 1000;
const CHUNK = 150;
export const FILTERS = ["all", "unsigned", "needs_resign", "in_progress", "no_method", "blocked", "live", "uncovered", "review"];
// The bulk email skips anyone asked this recently; a single resend skips a double click.
export const BULK_RESEND_GAP_MS = 3 * 24 * 60 * 60 * 1000;
export const SINGLE_RESEND_GAP_MS = 2 * 60 * 1000;

const missingSchema = (error) => ["PGRST205", "42P01", "42703", "PGRST200"].includes(error?.code);

async function pageAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function inChunks(ids, fetchChunk) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fetchChunk(ids.slice(i, i + CHUNK))));
  return out;
}

const groupBy = (rows, key) => {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r[key])) map.set(r[key], []);
    map.get(r[key]).push(r);
  }
  return map;
};

async function agreementRows(db, ids) {
  return inChunks(ids, async (chunk) => {
    const full = await db
      .from("landlord_agreements")
      .select(
        "id, user_id, version, status, signed_at, signer_name, signer_title, signed_file_key, signed_exhibit_file_key, provider, provider_envelope_id, ended_reason, ended_at, term_end, commission_rate_percent, created_at, updated_at, agreement_version:agreement_versions!version_id(id, label, kind, audience, published_at)"
      )
      .in("user_id", chunk)
      .neq("status", "superseded")
      .order("created_at", { ascending: false });
    if (!missingSchema(full.error)) {
      if (full.error) throw full.error;
      return full.data;
    }
    const { data, error } = await db
      .from("landlord_agreements")
      .select("id, user_id, version, status, signed_at, signer_name, signed_file_key, provider, provider_envelope_id, created_at, updated_at")
      .in("user_id", chunk)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });
}

/*
 * Every live offering these landlords have, with its property: { owner_id,
 * leaseId, listingId, address, unit }. Review sandbox listings are left out.
 */
async function liveOfferings(db, ids) {
  const rows = await inChunks(ids, (chunk) =>
    pageAll(() =>
      db
        .from("unit_leases")
        .select(
          "id, owner_id, listing_units!unit_id(listing_id, name, unit_number, unit_designator, title, published_at, deleted_at, listings!listing_id(id, address, city, state, zipcode, published_at, deleted_at, review_sandbox))"
        )
        .in("owner_id", chunk)
        .eq("is_active", true)
        .eq("unavailable", false)
        .is("deleted_at", null)
        .not("published_at", "is", null)
        .order("id")
    )
  );
  return rows
    .filter((r) => {
      const u = r.listing_units;
      const l = u?.listings;
      return u && !u.deleted_at && u.published_at && l && !l.deleted_at && l.published_at && l.review_sandbox !== true;
    })
    .map((r) => ({
      owner_id: r.owner_id,
      leaseId: r.id,
      listingId: r.listing_units.listing_id,
      address: displayAddress(r.listing_units.listings),
      unit: unitLabel(r.listing_units),
    }));
}

async function coverageRowsFor(db, ids) {
  return inChunks(ids, async (chunk) => {
    try {
      return await pageAll(() =>
        db
          .from("agreement_coverage")
          .select("user_id, listing_id, address, agreement_id, amendment_id, status, covered_at")
          .in("user_id", chunk)
          .eq("status", "covered")
          .order("id")
      );
    } catch (error) {
      if (missingSchema(error)) return [];
      throw error;
    }
  });
}

async function pendingAmendmentUsers(db, ids) {
  const rows = await inChunks(ids, async (chunk) => {
    const { data, error } = await db.from("agreement_amendments").select("user_id, created_at").in("user_id", chunk).eq("status", "sent");
    if (missingSchema(error)) return [];
    if (error) throw error;
    return data;
  });
  return new Map(rows.map((r) => [r.user_id, r.created_at]));
}

/*
 * One landlord's coverage for the overview: their live properties, the ones with
 * live offerings their agreement does not cover (and how many offerings), and
 * covered addresses that have changed since they were signed for.
 */
// `signer`: the account's authorized signer ({ name }) when someone else holds its agreement (Project B).
// `listingSigners`: Map listingId -> { name, state } for listings with their own
// signer (Wyatt, 2026-11-25): those are covered by that signer's agreement.
export function coverageSummary({ offerings = [], coverageRows = [], state, signer = null, listingSigners = new Map() }) {
  const covered = coveredMap(coverageRows.filter((r) => !listingSigners.has(r.listing_id)), { master: state.signed, masterValid: state.valid });
  for (const [listingId, ls] of listingSigners) {
    const theirs = coverageRows.filter((r) => r.listing_id === listingId);
    for (const [id, row] of coveredMap(theirs, { master: ls.state.signed, masterValid: ls.state.valid })) covered.set(id, row);
  }
  const byListing = new Map();
  for (const o of offerings) {
    const entry = byListing.get(o.listingId) ?? { listingId: o.listingId, address: o.address, offerings: 0, units: new Set() };
    entry.offerings += 1;
    if (o.unit) entry.units.add(o.unit);
    byListing.set(o.listingId, entry);
  }
  const uncovered = [...byListing.values()]
    .filter((p) => !covered.has(p.listingId))
    .map((p) => ({ listingId: p.listingId, address: p.address, offerings: p.offerings, units: [...p.units] }));
  const addressChanged = [...byListing.values()]
    .filter((p) => covered.has(p.listingId) && covered.get(p.listingId).address !== p.address)
    .map((p) => ({ listingId: p.listingId, signedAddress: covered.get(p.listingId).address, currentAddress: p.address }));
  // Every covered listing with how it is covered (Wyatt, 2026-11-09): whose
  // agreement, the agreement itself or an addendum to it, and since when.
  const coveredList = [...covered.entries()]
    .map(([listingId, row]) => ({
      listingId,
      address: byListing.get(listingId)?.address ?? row.address,
      via: listingSigners.has(listingId) || signer ? "authorized_signer" : "own",
      signerName: listingSigners.get(listingId)?.name ?? signer?.name ?? state.signed?.signer_name ?? null,
      document: row.amendment_id ? "addendum" : "agreement",
      coveredAt: row.covered_at ?? null,
    }))
    .sort((a, b) => String(a.address).localeCompare(String(b.address), "en", { numeric: true }));
  return {
    liveProperties: byListing.size,
    coveredCount: covered.size,
    coveredList,
    uncovered,
    uncoveredOfferings: uncovered.reduce((n, p) => n + p.offerings, 0),
    addressChanged,
  };
}

async function lastRequestEmails(db, ids) {
  const rows = await inChunks(ids, async (chunk) => {
    const { data, error } = await db
      .from("sent_emails")
      .select("user_id, created_at, status")
      .eq("kind", AGREEMENT_REQUEST_KIND)
      .in("user_id", chunk)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });
  const last = new Map();
  for (const r of rows) if (!last.has(r.user_id)) last.set(r.user_id, r);
  return last;
}

// One landlord's payment methods, as the overview shows them.
export function paymentSummary(methods, now = new Date()) {
  const live = (methods ?? []).filter((m) => !m.deleted_at);
  const shown = live.map((m) => ({
    description: describeMethod(m),
    status: effectiveStatus(m, now),
    isDefault: !!m.is_default,
    type: m.type,
  }));
  shown.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const usable = hasActivePaymentMethod(live, now);
  const state = usable
    ? "active"
    : shown.some((m) => m.status === "verifying")
      ? "verifying"
      : shown.some((m) => m.status === "failed" || m.status === "expired")
        ? "attention"
        : "none";
  return { state, methods: shown };
}

/*
 * Which accounts each paper copy still out was printed for: Map agreementId ->
 * Set of user ids, from the properties it holds. The record is the signer's, so
 * every account they sign for reads as out on paper, but the copy is downloaded,
 * recorded and voided only from the account whose properties are on it (Wyatt,
 * 2026-11-19).
 */
async function paperAccounts(db, agreementIds) {
  const out = new Map();
  const rows = await inChunks(agreementIds, async (chunk) => {
    const { data, error } = await db.from("agreement_coverage").select("user_id, agreement_id").in("agreement_id", chunk).eq("status", "proposed");
    if (missingSchema(error)) return [];
    if (error) throw error;
    return data;
  });
  for (const r of rows) {
    if (!out.has(r.agreement_id)) out.set(r.agreement_id, new Set());
    out.get(r.agreement_id).add(r.user_id);
  }
  return out;
}

// The paper copy as one account's row shows it: `here` when it was printed for
// this account, else `forName`, the account(s) it was printed for.
export function paperForAccount(paper, accountId, printedFor, nameOf) {
  if (!paper) return null;
  const accounts = printedFor.get(paper.id);
  // Nothing held on it (its properties were released): the controls stay with
  // whoever's record it is, so a signer's other accounts never get buttons that 404.
  const here = accounts?.size ? accounts.has(accountId) : paper.holderId === accountId;
  return { ...paper, here, forName: here ? null : [...accounts].map((id) => nameOf.get(id)).filter(Boolean).join(", ") || null };
}

// One landlord's unpaid invoices.
export function invoiceSummary(invoices) {
  const unpaid = (invoices ?? []).filter((i) => ["open", "failed", "processing"].includes(i.status) && i.invoice_date);
  return {
    unpaidCount: unpaid.length,
    unpaidCents: unpaid.reduce((s, i) => s + (i.total_cents ?? 0), 0),
    failedCount: unpaid.filter((i) => i.status === "failed").length,
    overdue: unpaid.some((i) => i.overdue_actioned_at && i.status !== "processing"),
  };
}

export function agreementSummary(state) {
  const { signed, pending, lastEnded, valid, needsResign, expired } = state;
  const paperOut = isPaperOut(state);
  const status = valid ? "signed" : paperOut ? "on_paper" : needsResign ? "needs_resign" : expired ? "expired" : pending ? "in_progress" : "not_signed";
  return {
    status,
    // A copy printed for paper signing, still out: its id and when it was printed.
    // holderId: whose record it is (the authorized signer's, for an account with one).
    paper: paperOut ? { id: pending.id, sentAt: pending.created_at, holderId: pending.user_id } : null,
    negotiated: signed?.agreement_version?.audience === "selected",
    // Signed, and a version made for them alone has gone live since: they are asked to sign it.
    newVersionReady: !!state.negotiatedOffer,
    flaggedForReview: !!state.flaggedForReview,
    commissionRatePercent: signed?.commission_rate_percent == null ? null : Number(signed.commission_rate_percent),
    hasSignedExhibit: !!signed?.signed_exhibit_file_key,
    signedAgreementId: signed?.signed_file_key ? signed.id : null,
    signedAt: signed?.signed_at ?? null,
    signerName: signed?.signer_name ?? null,
    signerTitle: signed?.signer_title ?? null,
    signedVersionLabel: signed?.agreement_version?.label ?? signed?.version ?? null,
    signedBy: signed ? (signed.provider === "documenso" ? "documenso" : "admin") : null,
    pendingSince: pending?.updated_at ?? null,
    lastEndedReason: !pending && !valid ? lastEnded?.ended_reason ?? null : null,
  };
}

export function matchesFilter(row, filter) {
  switch (filter) {
    case "unsigned":
      return row.agreement.status !== "signed";
    case "needs_resign":
      return row.agreement.status === "needs_resign" || !!row.agreement.newVersionReady;
    case "in_progress":
      return row.agreement.status === "in_progress" || row.agreement.status === "on_paper";
    case "no_method":
      return row.payment.state !== "active";
    case "blocked":
      return !row.publishing.allowed;
    case "live":
      return row.hasLiveListing;
    case "uncovered":
      return (row.coverage?.uncovered?.length ?? 0) > 0;
    case "review":
      return !!row.agreement.flaggedForReview || (row.coverage?.addressChanged?.length ?? 0) > 0;
    default:
      return true;
  }
}

/*
 * Every landlord, with their agreement, payment setup, unpaid invoices and
 * whether they can publish. `filter` and `search` narrow the rows; `counts` is
 * always for all landlords, so the filter chips show their totals.
 */
export async function loadLandlordOverview(db, { filter = "all", search = "", now = new Date() } = {}) {
  const landlords = await pageAll(() =>
    db
      .from("users")
      .select("id, name, email, created_at, billing_only, roles!role_id!inner(name)")
      .eq("roles.name", "landlord")
      .is("deleted_at", null)
      .order("id")
  );
  const ids = landlords.map((l) => l.id);

  const [live, agreements, methods, invoices, lastEmails, liveVersion, ownVersions, cutoff, settings, offerings, covRows, amending] = await Promise.all([
    liveListingOwners(db, ids),
    agreementRows(db, ids).then((r) => groupBy(r, "user_id")),
    inChunks(ids, async (chunk) => {
      const { data, error } = await db
        .from("payment_methods")
        .select("user_id, type, status, is_default, brand, last4, exp_month, exp_year, bank_name, deleted_at")
        .in("user_id", chunk)
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    }).then((r) => groupBy(r, "user_id")),
    inChunks(ids, async (chunk) => {
      const { data, error } = await db
        .from("billing_invoices")
        .select("landlord_id, status, total_cents, invoice_date, overdue_actioned_at")
        .in("landlord_id", chunk)
        .in("status", ["open", "failed", "processing"]);
      if (error) throw error;
      return data;
    }).then((r) => groupBy(r, "landlord_id")),
    lastRequestEmails(db, ids),
    getLiveVersion(db),
    liveLandlordVersions(db),
    resignCutoff(db),
    getGateSettings(db),
    liveOfferings(db, ids).then((r) => groupBy(r, "owner_id")),
    coverageRowsFor(db, ids).then((r) => groupBy(r, "user_id")),
    pendingAmendmentUsers(db, ids),
  ]);

  const autopays = await autopayByLandlord(db, ids);
  // Who pays for whom (Project B): an account with a payer is judged on the payer's
  // agreement and payment method, and is never asked to sign itself.
  const payerLinks = await inChunks(ids, async (chunk) => {
    const { data, error } = await db.from("billing_payers").select("id, landlord_id, payer_id, listing_id, role, signer_name, signer_email, declined_at, accepted_at").in("landlord_id", chunk).eq("status", "active");
    if (missingSchema(error)) return [];
    if (error) throw error;
    return data;
  });
  const signerLinks = payerLinks.filter((p) => (p.role ?? "signer") === "signer");
  const payerRoleLinks = payerLinks.filter((p) => p.role === "payer");
  const payerOf = new Map(signerLinks.filter((p) => !p.listing_id).map((p) => [p.landlord_id, p]));
  // Listings with their own signer, and authorized payers (Wyatt, 2026-11-25): landlordId -> [link].
  const listingLinksOf = groupBy(signerLinks.filter((p) => p.listing_id), "landlord_id");
  const payersOf = groupBy(payerRoleLinks, "landlord_id");
  const linkedListingIds = [...new Set(payerLinks.map((p) => p.listing_id).filter(Boolean))];
  const listingAddress = new Map();
  for (let i = 0; i < linkedListingIds.length; i += 200) {
    const { data, error } = await db.from("listings").select("id, address, city, state, zipcode").in("id", linkedListingIds.slice(i, i + 200));
    if (error) throw error;
    for (const b of data ?? []) listingAddress.set(b.id, displayAddress(b));
  }
  // How many accounts each person signs or pays for (all of one, or some of its listings).
  const paysFor = new Map();
  for (const [personId, accounts] of payerLinks.reduce((m, p) => m.set(p.payer_id, (m.get(p.payer_id) ?? new Set()).add(p.landlord_id)), new Map())) paysFor.set(personId, accounts.size);
  const licenses = await disclosuresFor(db, ids);
  const printedFor = await paperAccounts(
    db,
    [...agreements.values()].flat().filter((a) => a.provider === "paper" && a.status === "sent").map((a) => a.id)
  );
  const nameOf = new Map(landlords.map((l) => [l.id, l.name || l.email]));
  const rows = landlords.map((l) => {
    const payer = payerOf.get(l.id) ?? null;
    const holder = payer?.payer_id ?? l.id;
    // The version this landlord signs: their own when one is live, else the standard one.
    const state = summarizeAgreementRows(agreements.get(holder) ?? [], { liveVersion: ownVersions.get(holder) ?? liveVersion, cutoff, now });
    const listingSigners = new Map(
      (listingLinksOf.get(l.id) ?? []).map((b) => [
        b.listing_id,
        { name: b.signer_name, state: summarizeAgreementRows(agreements.get(b.payer_id) ?? [], { liveVersion: ownVersions.get(b.payer_id) ?? liveVersion, cutoff, now }) },
      ])
    );
    const coverage = coverageSummary({ offerings: offerings.get(l.id), coverageRows: covRows.get(l.id), state, signer: payer ? { name: payer.signer_name } : null, listingSigners });
    // The payment method that counts: the account's accepted payer's, else the signer's, else their own.
    const accountPayer = (payersOf.get(l.id) ?? []).find((p) => !p.listing_id) ?? null;
    const payment = paymentSummary(methods.get(accountPayer?.accepted_at ? accountPayer.payer_id : holder), now);
    const invoice = invoiceSummary(invoices.get(l.id));
    const publishing = gateDecision({
      role: "landlord",
      ...settings,
      hasPaymentMethod: payment.state === "active",
      agreementSigned: state.valid,
      overdueInvoice: invoice.overdue,
    });
    const email = lastEmails.get(l.id);
    const summary = agreementSummary(state);
    const paper = paperForAccount(summary.paper, l.id, printedFor, nameOf);
    // A paper copy holding this account reads as that, as the publish gate says it.
    if (paper?.here) publishing.missing = publishing.missing.map((m) => (m === "agreement" ? "paper_agreement" : m));
    return {
      id: l.id,
      name: l.name ?? null,
      email: l.email ?? null,
      hasLiveListing: live.has(l.id),
      agreement: { ...summary, paper, amendmentPendingSince: amending.get(l.id) ?? null },
      coverage,
      payment,
      autopay: autopays.get(l.id) ?? null,
      // Real estate license disclosure (lib/users/licenseDisclosure.js); null until answered.
      license: licenses.get(l.id) ?? null,
      invoices: invoice,
      publishing: { allowed: publishing.allowed, missing: publishing.missing },
      lastAgreementEmailAt: email?.created_at ?? null,
      lastAgreementEmailStatus: email?.status ?? null,
      // Project B: who signs and pays for this account, how many accounts it pays for, and whether it is a billing account.
      payer: payer ? { id: payer.payer_id, name: payer.signer_name, email: payer.signer_email, declined: !!payer.declined_at } : null,
      paysForCount: paysFor.get(l.id) ?? 0,
      billingOnly: l.billing_only === true,
      // Listings with their own authorized signer (Wyatt, 2026-11-25).
      listingSigners: (listingLinksOf.get(l.id) ?? []).map((b) => ({ linkId: b.id, listingId: b.listing_id, address: listingAddress.get(b.listing_id) ?? "Listing", name: b.signer_name, email: b.signer_email, declined: !!b.declined_at })),
      // Authorized payers: the account's (listingId null) and each listing's own; pending until they accept.
      authorizedPayers: (payersOf.get(l.id) ?? []).map((b) => ({ linkId: b.id, listingId: b.listing_id ?? null, address: b.listing_id ? listingAddress.get(b.listing_id) ?? "Listing" : null, name: b.signer_name, email: b.signer_email, status: b.accepted_at ? "accepted" : "pending" })),
    };
  });

  const counts = Object.fromEntries(FILTERS.map((f) => [f, rows.filter((r) => matchesFilter(r, f)).length]));
  const q = String(search ?? "").trim().toLowerCase();
  const shown = rows
    .filter((r) => matchesFilter(r, FILTERS.includes(filter) ? filter : "all"))
    .filter((r) => !q || `${r.name ?? ""} ${r.email ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.hasLiveListing) - Number(a.hasLiveListing) || (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));

  return {
    rows: shown,
    // Every landlord, whatever the filter: who the bulk email would reach is worked out from these.
    allRows: rows,
    counts,
    settings,
    liveVersion: liveVersion ? { id: liveVersion.id, label: liveVersion.label, publishedAt: liveVersion.published_at, requiresResign: liveVersion.requires_resign } : null,
  };
}

// ── The signing email ───────────────────────────────────────────────────────

// Has something to sign: no signature that counts, or a new version made for them alone.
export const needsSigningEmail = (row) => row.agreement.status !== "signed" || !!row.agreement.newVersionReady;

/*
 * Who "Email everyone who hasn't signed" reaches: landlords with something live
 * (an importer-made account with nothing live has nothing to publish), without a
 * signature that counts, and not asked in the last few days.
 */
export function bulkAudience(rows, now = new Date()) {
  return rows.filter(
    (r) =>
      r.hasLiveListing &&
      r.email &&
      // Their payer signs, not them (Project B).
      !r.payer &&
      needsSigningEmail(r) &&
      (!r.lastAgreementEmailAt || now.getTime() - new Date(r.lastAgreementEmailAt).getTime() > BULK_RESEND_GAP_MS)
  );
}

/*
 * Send the signing email to these landlords. `send(landlord, needsResign)`
 * resolves true when it went out. Capped per call, like the enrollment email.
 */
export async function sendAgreementRequests({ targets, send, limit = 300 }) {
  const batch = targets.slice(0, limit);
  let sent = 0;
  let failed = 0;
  for (const t of batch) {
    if (await send({ id: t.id, name: t.name, email: t.email }, t.agreement.status === "needs_resign" || !!t.agreement.newVersionReady)) sent += 1;
    else failed += 1;
  }
  return { attempted: batch.length, sent, failed, remaining: targets.length - batch.length };
}

// For a single resend: the landlord's row, refusing a double click.
export function singleTarget(rows, userId, now = new Date()) {
  const row = rows.find((r) => r.id === userId);
  if (!row) throw new BillingError("not_found", "That landlord was not found.", 404);
  if (!row.email) throw new BillingError("no_email", "This landlord has no email address.");
  if (!needsSigningEmail(row)) throw new BillingError("already_signed", "This landlord has already signed the current agreement.", 409);
  if (row.lastAgreementEmailAt && now.getTime() - new Date(row.lastAgreementEmailAt).getTime() < SINGLE_RESEND_GAP_MS) {
    throw new BillingError("just_sent", "This landlord was emailed a moment ago.", 409);
  }
  return row;
}
