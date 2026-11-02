/*
 * The admin dashboard's view of every landlord's commission agreement and
 * payment setup, one row each, with whether they can publish right now.
 *
 * Read-only. Everything is loaded in a few batched queries (landlords number in
 * the hundreds), then filtered and searched here.
 *
 *   filter  all | unsigned | needs_resign | in_progress | no_method | blocked | live
 *
 * Also: who the "email everyone who hasn't signed" button reaches, and sending
 * the signing email (one landlord or that whole group).
 *
 * `db` is a service-role Supabase client.
 */
import { BillingError } from "./errors.js";
import { AGREEMENT_REQUEST_KIND } from "./constants.js";
import { liveListingOwners } from "./enrollment.js";
import { getLiveVersion, resignCutoff } from "./agreementVersions.js";
import { summarizeAgreementRows } from "./agreements.js";
import { describeMethod, effectiveStatus, hasActivePaymentMethod } from "./paymentMethodState.js";
import { gateDecision, getGateSettings } from "./listingGate.js";

const PAGE = 1000;
const CHUNK = 150;
export const FILTERS = ["all", "unsigned", "needs_resign", "in_progress", "no_method", "blocked", "live"];
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
        "id, user_id, version, status, signed_at, signer_name, signer_title, signed_file_key, provider, provider_envelope_id, ended_reason, ended_at, created_at, updated_at, agreement_version:agreement_versions!version_id(id, label, published_at)"
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
  const { signed, pending, lastEnded, valid, needsResign } = state;
  const status = valid ? "signed" : needsResign ? "needs_resign" : pending ? "in_progress" : "not_signed";
  return {
    status,
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
      return row.agreement.status === "needs_resign";
    case "in_progress":
      return row.agreement.status === "in_progress";
    case "no_method":
      return row.payment.state !== "active";
    case "blocked":
      return !row.publishing.allowed;
    case "live":
      return row.hasLiveListing;
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
      .select("id, name, email, created_at, roles!role_id!inner(name)")
      .eq("roles.name", "landlord")
      .is("deleted_at", null)
      .order("id")
  );
  const ids = landlords.map((l) => l.id);

  const [live, agreements, methods, invoices, lastEmails, liveVersion, cutoff, settings] = await Promise.all([
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
    resignCutoff(db),
    getGateSettings(db),
  ]);

  const rows = landlords.map((l) => {
    const state = summarizeAgreementRows(agreements.get(l.id) ?? [], { liveVersion, cutoff });
    const payment = paymentSummary(methods.get(l.id), now);
    const invoice = invoiceSummary(invoices.get(l.id));
    const publishing = gateDecision({
      role: "landlord",
      ...settings,
      hasPaymentMethod: payment.state === "active",
      agreementSigned: state.valid,
      overdueInvoice: invoice.overdue,
    });
    const email = lastEmails.get(l.id);
    return {
      id: l.id,
      name: l.name ?? null,
      email: l.email ?? null,
      hasLiveListing: live.has(l.id),
      agreement: agreementSummary(state),
      payment,
      invoices: invoice,
      publishing: { allowed: publishing.allowed, missing: publishing.missing },
      lastAgreementEmailAt: email?.created_at ?? null,
      lastAgreementEmailStatus: email?.status ?? null,
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
      r.agreement.status !== "signed" &&
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
    if (await send({ id: t.id, name: t.name, email: t.email }, t.agreement.status === "needs_resign")) sent += 1;
    else failed += 1;
  }
  return { attempted: batch.length, sent, failed, remaining: targets.length - batch.length };
}

// For a single resend: the landlord's row, refusing a double click.
export function singleTarget(rows, userId, now = new Date()) {
  const row = rows.find((r) => r.id === userId);
  if (!row) throw new BillingError("not_found", "That landlord was not found.", 404);
  if (!row.email) throw new BillingError("no_email", "This landlord has no email address.");
  if (row.agreement.status === "signed") throw new BillingError("already_signed", "This landlord has already signed the current agreement.", 409);
  if (row.lastAgreementEmailAt && now.getTime() - new Date(row.lastAgreementEmailAt).getTime() < SINGLE_RESEND_GAP_MS) {
    throw new BillingError("just_sent", "This landlord was emailed a moment ago.", 409);
  }
  return row;
}
