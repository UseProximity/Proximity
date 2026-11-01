/*
 * The emails a failed invoice payment sends, wired to the real senders. Passed to
 * the billing run (and, later, the webhook handlers) as `notify`, so the library
 * code stays free of the email transport and can be tested with a stand-in.
 */
import { getBaseUrl } from "@/lib/email";
import { sendPaymentFailedEmail, sendPaymentFailedTeamEmail } from "./billingEmails";

export function billingNotify() {
  return {
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
  };
}
