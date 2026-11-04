/*
 * The emails a failed invoice payment sends, wired to the real senders. Passed to
 * the billing run (and, later, the webhook handlers) as `notify`, so the library
 * code stays free of the email transport and can be tested with a stand-in.
 */
import { getBaseUrl } from "@/lib/email";
import { periodLabel } from "./invoicing";
import {
  sendAutopayOffEmail,
  sendInvoiceIssuedEmail,
  sendPaymentMethodAttentionEmail,
  sendOverdueEmail,
  sendOverdueTeamEmail,
  sendPaymentFailedEmail,
  sendPaymentFailedTeamEmail,
} from "./billingEmails";

export function billingNotify() {
  return {
    // The monthly invoice was sent (or an admin resent it). Resolves whether it was handed to the mailer.
    invoiceIssued({ landlord, invoice, lines, autopay }) {
      const payUrl = `${getBaseUrl()}/dashboard/landlord?tab=payments#invoices`;
      return sendInvoiceIssuedEmail(
        { id: landlord.id, email: landlord.email, name: landlord.name },
        {
          periodLabel: periodLabel(invoice.billing_period),
          lines,
          totalCents: invoice.total_cents,
          dueDate: invoice.due_date,
          payUrl,
          hostedUrl: invoice.hosted_invoice_url ?? null,
          autopay,
        }
      );
    },

    // Autopay was switched off for a reason the landlord did not choose (method gone, failures, an admin).
    autopayOff({ landlord, reason, methodDescription }) {
      const paymentsUrl = `${getBaseUrl()}/dashboard/landlord?tab=payments#autopay`;
      return sendAutopayOffEmail({ id: landlord.id, email: landlord.email, name: landlord.name }, { reason, methodDescription, paymentsUrl });
    },

    // Landlord and team are both told once, when the failure is first recorded.
    async paymentFailed({ invoice, landlord, message }) {
      const paymentsUrl = `${getBaseUrl()}/dashboard/landlord?tab=payments`;
      if (landlord?.email) {
        await sendPaymentFailedEmail(
          { id: landlord.id, email: landlord.email, name: landlord.name },
          { totalCents: invoice.total_cents, retryUrl: invoice.hosted_invoice_url || paymentsUrl, reason: message }
        );
      }
      await sendPaymentFailedTeamEmail({
        landlordName: landlord?.name,
        landlordEmail: landlord?.email,
        totalCents: invoice.total_cents,
        reason: message,
      });
    },

    // Their default method will not pay the next invoice (expiring, expired or failed).
    async methodAttention({ landlord, state, description }) {
      const paymentsUrl = `${getBaseUrl()}/dashboard/landlord?tab=payments`;
      await sendPaymentMethodAttentionEmail(
        { id: landlord.id, email: landlord.email, name: landlord.name },
        { state, description, paymentsUrl }
      );
    },

    // The overdue job hid the landlord's leases: tell them how to get them back, and tell the team.
    async overdue({ invoice, landlord, withdrawnCount }) {
      const paymentsUrl = `${getBaseUrl()}/dashboard/landlord?tab=payments`;
      if (landlord?.email) {
        await sendOverdueEmail(
          { id: landlord.id, email: landlord.email, name: landlord.name },
          { totalCents: invoice.total_cents, invoiceDate: invoice.invoice_date, dueDate: invoice.due_date ?? null, paymentsUrl }
        );
      }
      await sendOverdueTeamEmail({
        landlordName: landlord?.name,
        landlordEmail: landlord?.email,
        totalCents: invoice.total_cents,
        invoiceDate: invoice.invoice_date,
        withdrawnCount,
      });
    },
  };
}
