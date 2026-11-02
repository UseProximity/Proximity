/*
 * When an unpaid invoice is overdue enough to withdraw the landlord's leases.
 *
 * Counted from the invoice date, never from a charge date: Approved charges
 * under the minimum can sit for months without an invoice and must never
 * trigger a withdrawal, and this only ever looks at invoices.
 *
 * An ACH payment still Processing is not overdue (the clock pauses while the
 * bank settles; the PRD leaves this open and this is the default). If the
 * payment then fails, the invoice is Failed and the clock counts again from
 * its original date. An invoice already actioned is never actioned twice.
 */
import { DAY_MS, OVERDUE_DAYS } from "./constants.js";

const UNPAID = new Set(["open", "failed"]);

// An invoice left unfinished by a billing run for this long is flagged to admins.
const UNFINISHED_AFTER_MS = DAY_MS;

export function isInvoiceOverdue(invoice, now = new Date()) {
  if (!invoice || invoice.overdue_actioned_at) return false;
  if (!UNPAID.has(invoice.status)) return false;
  // No invoice date means Stripe never finalized it: the landlord was never sent
  // anything they could pay, so it can never be overdue.
  if (!invoice.invoice_date) return false;
  const age = now.getTime() - new Date(invoice.invoice_date).getTime();
  return age > OVERDUE_DAYS * DAY_MS;
}

/*
 * Why an invoice is on the admin's "needs attention" list, or null if it is not.
 * Failed invoices always are. An unpaid one is once it is past the overdue
 * limit, even after its leases were withdrawn (the admin still has to restore
 * them), so this does not look at overdue_actioned_at. A payment still
 * processing is left alone. One a billing run never finished (no invoice date
 * a day after it was started) is listed as "unfinished".
 */
export function invoiceAttentionReason(invoice, now = new Date()) {
  if (!invoice) return null;
  if (invoice.status === "failed") return "failed";
  if (!UNPAID.has(invoice.status)) return null;
  // A run stopped before Stripe finalized it. The next run picks it up, but an
  // admin should know it is stuck rather than find out a month later.
  if (!invoice.invoice_date) {
    const since = now.getTime() - new Date(invoice.created_at ?? now).getTime();
    return since > UNFINISHED_AFTER_MS ? "unfinished" : null;
  }
  const age = now.getTime() - new Date(invoice.invoice_date).getTime();
  return age > OVERDUE_DAYS * DAY_MS ? "overdue" : null;
}
