/*
 * A landlord's invoices, and paying one: Pay now (or Retry payment) on an invoice
 * whose payment failed.
 *
 * Retrying makes exactly one attempt with the landlord's default active payment
 * method. Nothing retries on its own (invoices are created with auto_advance
 * off), so every attempt is a person pressing the button, or the monthly run.
 * The outcome that matters (paid, failed, processing) arrives by webhook, which
 * is why starting a payment is all this does on success.
 *
 * A landlord who wants a different method pays from Stripe's hosted invoice page
 * (the invoice's hosted_invoice_url), which collects a new one itself.
 *
 * `db` is a service-role Supabase client and `stripe` a Stripe client.
 */
import { BillingError } from "./errors.js";
import { chargeableMethod } from "./paymentMethods.js";
import { payInvoice, paymentFailureMessage, paymentUnderway, recordPaymentFailure } from "./invoicing.js";

const COLUMNS =
  "id, landlord_id, billing_period, stripe_invoice_id, status, total_cents, invoice_date, hosted_invoice_url, invoice_pdf_url, last_failure_message, disputed";

export function invoiceView(row) {
  return {
    id: row.id,
    billingPeriod: row.billing_period,
    status: row.status,
    totalCents: row.total_cents,
    invoiceDate: row.invoice_date,
    hostedInvoiceUrl: row.hosted_invoice_url ?? null,
    invoicePdfUrl: row.invoice_pdf_url ?? null,
    failureMessage: row.status === "failed" ? row.last_failure_message ?? null : null,
    // Pay now is offered on an issued invoice that is open or failed; not while a
    // payment is settling, and not on one a billing run has not finished issuing.
    canPay: !!row.invoice_date && (row.status === "failed" || row.status === "open"),
  };
}

export async function listInvoicesForLandlord(db, landlordId) {
  const { data, error } = await db
    .from("billing_invoices")
    .select(COLUMNS)
    .eq("landlord_id", landlordId)
    .order("billing_period", { ascending: false });
  if (error) throw error;
  return data.map(invoiceView);
}

/*
 * Pay an invoice again. `landlordId` limits it to that landlord's own invoice (a
 * landlord's Pay now); leave it null for an admin's retry.
 */
export async function retryInvoicePayment(db, stripe, { invoiceId, landlordId = null, now = new Date() }) {
  let q = db.from("billing_invoices").select(COLUMNS).eq("id", invoiceId);
  if (landlordId) q = q.eq("landlord_id", landlordId);
  const { data: row, error } = await q.maybeSingle();
  if (error) throw error;
  if (!row) throw new BillingError("not_found", "Invoice not found.", 404);

  if (row.status === "paid") throw new BillingError("already_paid", "This invoice is already paid.", 409);
  if (row.status === "processing") {
    throw new BillingError("in_progress", "A payment for this invoice is already in progress.", 409);
  }
  if (!["failed", "open"].includes(row.status) || !row.stripe_invoice_id || !row.invoice_date) {
    throw new BillingError("not_payable", "This invoice cannot be paid right now.", 409);
  }

  const invoice = await stripe.invoices.retrieve(row.stripe_invoice_id);
  if (invoice.status === "paid") return { alreadyPaid: true }; // the webhook is about to catch up
  if (invoice.status !== "open") {
    throw new BillingError("not_payable", "This invoice cannot be paid right now.", 409);
  }

  // An ACH payment the run (or an earlier click) started may still be settling
  // before its webhook has marked the row Processing. Paying again would be refused
  // and read as a failure.
  const underway = await paymentUnderway(stripe, invoice.id);
  if (underway === "paid") return { alreadyPaid: true };
  if (underway === "processing") {
    throw new BillingError("in_progress", "A payment for this invoice is already in progress.", 409);
  }

  const method = await chargeableMethod(db, stripe, row.landlord_id, now);
  if (!method) {
    throw new BillingError(
      "no_method",
      "Add an active payment method first, or pay from the invoice page with a different one.",
      409
    );
  }

  // Back to Open while the attempt is made, so a failure is recorded as a fresh one.
  if (row.status === "failed") {
    const { error: reopenError } = await db.from("billing_invoices").update({ status: "open" }).eq("id", row.id).eq("status", "failed");
    if (reopenError) throw reopenError;
  }

  try {
    await payInvoice(stripe, invoice.id, method.stripe_payment_method_id);
  } catch (err) {
    const raced = await paymentUnderway(stripe, invoice.id);
    if (raced === "paid") return { alreadyPaid: true };
    if (raced === "processing") return { started: true };
    // Recorded quietly: the person who pressed the button sees the reason right away.
    const message = paymentFailureMessage(err);
    await recordPaymentFailure(db, { invoiceId: row.id, message, notify: null, now });
    throw new BillingError("payment_failed", message, 402);
  }
  return { started: true };
}
