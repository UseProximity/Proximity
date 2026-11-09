/*
 * How a charge row is shown to a landlord. Pure, so the labels can be tested:
 * every place a charge appears (dashboard, admin view, invoice line, emails)
 * shows its listing and lease, built the same way here.
 */
import { landlordActions, reviewEndsAt } from "./chargeLifecycle.js";
import { triggerLabel } from "./invoicePlan.js";
import { formatCents } from "./money.js";

// "8% of $1,500.00 signed rent" when both are known, either part alone otherwise, else null.
export function basisLabel({ signedRentCents = null, commissionRatePercent = null }) {
  const rate = commissionRatePercent != null ? `${Number(commissionRatePercent)}%` : null;
  const rent = signedRentCents != null ? `${formatCents(signedRentCents)} signed rent` : null;
  if (rate && rent) return `${rate} of ${rent}`;
  if (rate) return `Commission rate ${rate}`;
  return rent;
}

// "Unit 2, 12-month", "Whole property, 10 or 12-month", "2 bed"
export function leaseLabel(lease) {
  if (!lease) return null;
  const unit = lease.listing_units;
  let unitPart = null;
  if (unit) {
    if (unit.name) unitPart = unit.name;
    else if (unit.unit_designator === "Whole") unitPart = "Whole property";
    else if (unit.unit_designator && unit.unit_number) unitPart = `${unit.unit_designator} ${unit.unit_number}`;
    else if (unit.bedrooms != null) unitPart = `${unit.bedrooms} bed`;
  }
  const months = (lease.lease_term_months ?? []).filter((m) => Number.isFinite(m));
  const termPart = months.length ? `${months.join(" or ")}-month` : null;
  return [unitPart, termPart].filter(Boolean).join(", ") || null;
}

// One plain sentence on where a charge stands and what happens next.
export function statusMessage(charge) {
  switch (charge.status) {
    case "unconfirmed":
      return "Waiting for Proximity to confirm it. You can approve it now or contest it.";
    case "pending":
      return charge.reviewEndsAt
        ? "In review. It is approved automatically after the review period, or you can approve or contest it now."
        : "In review. You can approve or contest it now.";
    case "approved":
      return "Approved. It will be included in your next monthly invoice.";
    case "invoiced":
      return "On a monthly invoice. Payment is not complete yet.";
    case "paid":
      return refundedInFull(charge) ? "Refunded in full." : "Paid.";
    case "contested":
      return "Contested. We will email you the outcome.";
    case "voided":
      return "Removed. You will not be charged for this.";
    default:
      return "";
  }
}

// The admin's shape of a charge row: everything the landlord sees, plus who they
// are and the internal resolution note.
export function adminChargeView(row, now = new Date()) {
  return {
    ...chargeView(row, now),
    landlord: {
      id: row.landlord_id,
      name: row.landlord?.name ?? null,
      email: row.landlord?.email ?? null,
    },
    triggerRef: row.trigger_ref ?? null,
    pendingAt: row.pending_at ?? null,
    contestedAt: row.contested_at ?? null,
    resolutionNote: row.resolution_note ?? null,
    isTest: !!row.is_test,
  };
}

// The landlord-facing shape of a charge row joined with its listing, lease and
// student. Deliberately leaves out the admin's internal resolution note.
export function chargeView(row, now = new Date()) {
  const ends = reviewEndsAt(row);
  return {
    id: row.id,
    amountCents: row.amount_cents,
    description: row.description ?? null,
    triggerType: row.trigger_type,
    triggerLabel: triggerLabel(row.trigger_type),
    status: row.status,
    createdAt: row.created_at,
    // When it was settled (Paid or Removed), which decides where it is listed.
    settledAt: settledAt(row),
    reviewEndsAt: ends ? ends.toISOString() : null,
    contestReason: row.contest_reason ?? null,
    listingLabel: row.listing?.address ?? row.listing?.title ?? null,
    leaseLabel: leaseLabel(row.lease),
    studentName: row.student?.name ?? null,
    // The commission basis: the rent signed for and the agreement's rate, when known.
    signedRentCents: row.signed_rent_cents ?? null,
    commissionRatePercent: row.commission_rate_percent != null ? Number(row.commission_rate_percent) : null,
    actions: landlordActions(row),
    // Refunds and credits an admin made on this Paid charge, oldest first (never the admin's reason).
    adjustments: (row.adjustments ?? [])
      .map((a) => ({ kind: a.kind, amountCents: a.amount_cents, createdAt: a.created_at }))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
  };
}

// When a Paid or Removed charge was settled, or null while it is still in progress.
function settledAt(row) {
  if (row.status === "paid") return row.paid_at ?? row.created_at;
  if (row.status === "voided") return row.voided_at ?? row.created_at;
  return null;
}

// How much of a charge an admin has refunded or credited (`kind` for one of them), in cents.
export function adjustedCents(charge, kind = null) {
  return (charge.adjustments ?? []).filter((a) => !kind || a.kind === kind).reduce((sum, a) => sum + a.amountCents, 0);
}

// A Paid charge whose money all went back to the landlord.
export const refundedInFull = (charge) => charge.status === "paid" && adjustedCents(charge, "refund") >= charge.amountCents;

// The latest thing that happened to a settled charge: when it settled, or a later refund or credit.
function lastActivity(c) {
  const times = [c.settledAt, ...(c.adjustments ?? []).map((a) => a.createdAt)].filter(Boolean);
  return times.sort().at(-1) ?? null;
}

const MONTH_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" });
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "long" });
const monthOf = (d) => MONTH_KEY.format(new Date(d)).slice(0, 7);

/*
 * The landlord's Charges card, split so the list does not grow forever (Simão,
 * 2026-11-07; Wyatt chose grouping by month). `current` is everything still in
 * progress plus what was paid or removed this month (Central time); `past` is
 * the rest, one group per month it was settled in, newest month first, each
 * with how many charges, how much was paid and how much of that was refunded or
 * credited. Charges keep their order inside.
 *
 * A charge refunded or credited this month stays in the main list even when it
 * was paid earlier: the email about it sends the landlord to Billing to see it.
 */
export function splitChargeHistory(charges, now = new Date()) {
  const thisMonth = monthOf(now);
  const current = [];
  const months = new Map();
  for (const c of charges) {
    if (!c.settledAt || monthOf(lastActivity(c)) >= thisMonth) {
      current.push(c);
      continue;
    }
    const key = monthOf(c.settledAt);
    if (!months.has(key)) {
      months.set(key, {
        month: key,
        label: MONTH_LABEL.format(new Date(c.settledAt)),
        charges: [],
        paidCents: 0,
        refundedCents: 0,
        creditedCents: 0,
        removedCount: 0,
      });
    }
    const group = months.get(key);
    group.charges.push(c);
    if (c.status === "paid") {
      group.paidCents += c.amountCents;
      group.refundedCents += adjustedCents(c, "refund");
      group.creditedCents += adjustedCents(c, "credit");
    } else group.removedCount += 1;
  }
  const past = [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
  return { current, past };
}
