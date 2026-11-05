/*
 * Turns charges into the invoices the monthly run will create. Pure: it reads
 * rows and returns a plan, so the same code backs the dry-run (which creates
 * nothing in Stripe) and the real run, and the totals can be checked first.
 *
 * Rules (PRD, Monthly billing run):
 *   - only Approved charges not already on an invoice are billed
 *   - one invoice per landlord, one line per charge
 *   - a landlord whose total is under the minimum gets no invoice; the charges
 *     stay Approved and roll into the next month
 *   - each invoice carries an idempotency key built from landlord and period, so
 *     re-running after a crash cannot create a second one
 *
 * Charge rows come with the display fields joined in by the caller:
 * listing_label, lease_label and student_name (any may be null).
 */
import { MIN_INVOICE_CENTS } from "./constants.js";

const MAX_LINE_LENGTH = 400;

export function invoiceIdempotencyKey(landlordId, billingPeriod) {
  return `invoice:${landlordId}:${billingPeriod}`;
}

// "student_review_outcome" -> "Student review outcome"
export function triggerLabel(triggerType) {
  const s = String(triggerType ?? "").replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Charge";
}

// One invoice line: the trigger, then the listing, lease and student it came from.
export function lineDescription(charge) {
  const parts = [triggerLabel(charge.trigger_type)];
  if (charge.listing_label) parts.push(`Listing: ${charge.listing_label}`);
  if (charge.lease_label) parts.push(`Lease: ${charge.lease_label}`);
  if (charge.student_name) parts.push(`Student: ${charge.student_name}`);
  const text = parts.join(" | ");
  return text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH - 3)}...` : text;
}

export function planInvoices(charges, { billingPeriod, minCents = MIN_INVOICE_CENTS }) {
  const billable = (charges ?? [])
    .filter((c) => c.status === "approved" && !c.invoice_id)
    // A stable order, so a re-run builds the same lines in the same sequence.
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));

  const byLandlord = new Map();
  for (const c of billable) {
    if (!byLandlord.has(c.landlord_id)) byLandlord.set(c.landlord_id, []);
    byLandlord.get(c.landlord_id).push(c);
  }

  const invoices = [];
  const deferred = [];
  for (const [landlordId, rows] of byLandlord) {
    const totalCents = rows.reduce((sum, c) => sum + c.amount_cents, 0);
    if (totalCents < minCents) {
      deferred.push({ landlordId, totalCents, chargeCount: rows.length });
      continue;
    }
    invoices.push({
      landlordId,
      billingPeriod,
      idempotencyKey: invoiceIdempotencyKey(landlordId, billingPeriod),
      totalCents,
      lines: rows.map((c) => ({
        chargeId: c.id,
        amountCents: c.amount_cents,
        description: lineDescription(c),
      })),
    });
  }

  return {
    invoices,
    deferred,
    grandTotalCents: invoices.reduce((sum, inv) => sum + inv.totalCents, 0),
  };
}
