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
