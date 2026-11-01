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

export function isInvoiceOverdue(invoice, now = new Date()) {
  if (!invoice || invoice.overdue_actioned_at) return false;
  if (!UNPAID.has(invoice.status)) return false;
  const age = now.getTime() - new Date(invoice.invoice_date).getTime();
  return age > OVERDUE_DAYS * DAY_MS;
}

/*
 * Why an invoice is on the admin's "needs attention" list, or null if it is not.
 * Failed invoices always are. An unpaid one is once it is past the overdue
 * limit, even after its leases were withdrawn (the admin still has to restore
 * them), so this does not look at overdue_actioned_at. A payment still
 * processing is left alone.
 */
export function invoiceAttentionReason(invoice, now = new Date()) {
  if (!invoice) return null;
  if (invoice.status === "failed") return "failed";
  if (!UNPAID.has(invoice.status)) return null;
  const age = now.getTime() - new Date(invoice.invoice_date).getTime();
  return age > OVERDUE_DAYS * DAY_MS ? "overdue" : null;
}
