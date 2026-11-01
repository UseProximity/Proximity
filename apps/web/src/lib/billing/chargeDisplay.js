/*
 * How a charge row is shown to a landlord. Pure, so the labels can be tested:
 * every place a charge appears (dashboard, admin view, invoice line, emails)
 * shows its listing and lease, built the same way here.
 */
import { landlordActions, reviewEndsAt } from "./chargeLifecycle.js";
import { triggerLabel } from "./invoicePlan.js";

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
      return "Paid.";
    case "contested":
      return "Contested. We will email you the outcome.";
    case "voided":
      return "Removed. You will not be charged for this.";
    default:
      return "";
  }
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
    reviewEndsAt: ends ? ends.toISOString() : null,
    contestReason: row.contest_reason ?? null,
    listingLabel: row.listing?.address ?? row.listing?.title ?? null,
    leaseLabel: leaseLabel(row.lease),
    studentName: row.student?.name ?? null,
    actions: landlordActions(row),
  };
}
