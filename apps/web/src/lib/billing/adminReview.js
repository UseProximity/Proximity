/*
 * The admin side of the charge lifecycle, behind the admin review view:
 *
 *   confirm         Unconfirmed -> Pending, which starts the 7 day review clock.
 *                   The lifecycle depends on this step, so the view lists every
 *                   Unconfirmed charge.
 *   resolve         a Contested charge goes to Approved (Proximity's favour) or
 *                   Voided (against the charge). A written internal note is
 *                   required, and the landlord is emailed the outcome.
 *   void            an Unconfirmed, Pending or Approved charge is dropped, with
 *                   a note. A charge already on an invoice is not voided here:
 *                   that also has to change the Stripe invoice (see the billing
 *                   run), so it is refused rather than half done.
 *
 * Every action is written to the charge's status history with the admin as the
 * actor, by rpc_transition_charge. The list also shows chargebacks and failed or
 * overdue invoices, which are read-only here.
 *
 * `db` is a service-role Supabase client, passed in so this stays testable.
 */
import { BillingError } from "./errors.js";
import { adminChargeView } from "./chargeDisplay.js";
import { transitionCharge } from "./charges.js";
import { invoiceAttentionReason } from "./overdue.js";
import { DAY_MS } from "./constants.js";

const ADMIN_COLUMNS = `
  id, landlord_id, amount_cents, description, trigger_type, trigger_ref, status, created_at,
  pending_at, contested_at, contest_reason, resolved_at, resolution_note, is_test,
  landlord:users!landlord_id(name, email),
  listing:listings!listing_id(title, address),
  lease:unit_leases!lease_id(lease_term_months, listing_units!unit_id(name, unit_designator, unit_number, bedrooms)),
  student:users!student_id(name)
`;

const QUEUE_LIMIT = 200;

async function chargesWithStatus(db, status, now) {
  const { data, error } = await db
    .from("charges")
    .select(ADMIN_COLUMNS)
    .eq("status", status)
    .order("created_at", { ascending: true })
    .limit(QUEUE_LIMIT);
  if (error) throw error;
  return data.map((row) => adminChargeView(row, now));
}

async function chargebacks(db) {
  const { data, error } = await db
    .from("billing_disputes")
    .select(
      "id, stripe_dispute_id, amount_cents, reason, status, created_at, invoice:billing_invoices!invoice_id(id, total_cents, landlord:users!landlord_id(name, email))"
    )
    .order("created_at", { ascending: false })
    .limit(QUEUE_LIMIT);
  if (error) throw error;
  return data.map((d) => ({
    id: d.id,
    amountCents: d.amount_cents,
    reason: d.reason,
    status: d.status,
    createdAt: d.created_at,
    invoiceId: d.invoice?.id ?? null,
    landlord: { name: d.invoice?.landlord?.name ?? null, email: d.invoice?.landlord?.email ?? null },
  }));
}

async function invoicesNeedingAttention(db, now) {
  const { data, error } = await db
    .from("billing_invoices")
    .select(
      "id, landlord_id, status, total_cents, invoice_date, last_failure_message, disputed, overdue_actioned_at, landlord:users!landlord_id(name, email)"
    )
    .in("status", ["open", "failed"])
    .order("invoice_date", { ascending: true })
    .limit(QUEUE_LIMIT);
  if (error) throw error;
  return data
    .map((inv) => ({ inv, reason: invoiceAttentionReason(inv, now) }))
    .filter(({ reason }) => reason)
    .map(({ inv, reason }) => ({
      id: inv.id,
      reason,
      status: inv.status,
      totalCents: inv.total_cents,
      invoiceDate: inv.invoice_date,
      daysOld: Math.floor((now.getTime() - new Date(inv.invoice_date).getTime()) / DAY_MS),
      failureMessage: inv.last_failure_message ?? null,
      disputed: inv.disputed,
      leasesWithdrawn: !!inv.overdue_actioned_at,
      landlord: { id: inv.landlord_id, name: inv.landlord?.name ?? null, email: inv.landlord?.email ?? null },
    }));
}

export async function loadAdminReview(db, now = new Date()) {
  const [unconfirmed, contested, disputes, invoices] = await Promise.all([
    chargesWithStatus(db, "unconfirmed", now),
    chargesWithStatus(db, "contested", now),
    chargebacks(db),
    invoicesNeedingAttention(db, now),
  ]);
  return { unconfirmed, contested, chargebacks: disputes, invoices };
}

async function chargeStatus(db, chargeId) {
  const { data, error } = await db.from("charges").select("id, status").eq("id", chargeId).maybeSingle();
  if (error) throw error;
  if (!data) throw new BillingError("not_found", "Charge not found.", 404);
  return data.status;
}

// One charge as the admin sees it, with the landlord's contact details (for the outcome email).
export async function getAdminChargeView(db, chargeId, now = new Date()) {
  const { data, error } = await db.from("charges").select(ADMIN_COLUMNS).eq("id", chargeId).maybeSingle();
  if (error) throw error;
  if (!data) throw new BillingError("not_found", "Charge not found.", 404);
  return adminChargeView(data, now);
}

export async function adminConfirmCharge(db, { chargeId, adminId }) {
  return transitionCharge(db, {
    chargeId,
    expectedFrom: "unconfirmed",
    to: "pending",
    actorType: "admin",
    actorUserId: adminId,
  });
}

export async function adminResolveContest(db, { chargeId, adminId, outcome, note }) {
  if (outcome !== "approved" && outcome !== "voided") {
    throw new BillingError("bad_outcome", "Resolve a contest as approved or voided.");
  }
  if (!String(note ?? "").trim()) {
    throw new BillingError("note_required", "A written internal note is required to resolve a contest.");
  }
  return transitionCharge(db, {
    chargeId,
    expectedFrom: "contested",
    to: outcome,
    actorType: "admin",
    actorUserId: adminId,
    note,
  });
}

export async function adminVoidCharge(db, { chargeId, adminId, note }) {
  if (!String(note ?? "").trim()) {
    throw new BillingError("note_required", "A written internal note is required to void a charge.");
  }
  const status = await chargeStatus(db, chargeId);
  if (!["unconfirmed", "pending", "approved"].includes(status)) {
    throw new BillingError(
      "not_allowed",
      status === "contested"
        ? "Resolve a contested charge instead of voiding it."
        : "A charge on an invoice, or one already paid or voided, cannot be voided here.",
      409
    );
  }
  return transitionCharge(db, {
    chargeId,
    expectedFrom: status,
    to: "voided",
    actorType: "admin",
    actorUserId: adminId,
    note,
  });
}
