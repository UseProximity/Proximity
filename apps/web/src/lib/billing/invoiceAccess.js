/*
 * A landlord's invoices, paying one (Pay now, or Retry payment after a failure),
 * and an admin re-sending the invoice email.
 *
 * Paying makes exactly one attempt with the landlord's default active payment
 * method, and only because the landlord pressed the button: that click is their
 * consent (decisions of 2026-11-04). Admins cannot charge a landlord; they can
 * resend the invoice email. Apart from this, only autopay the landlord switched
 * on charges anything (autopay.js). The outcome that matters (paid, failed,
 * processing) arrives by webhook, which is why starting a payment is all this
 * does on success.
 *
 * A landlord who wants a different method pays from Stripe's hosted invoice page
 * (the invoice's hosted_invoice_url), which collects a new one itself.
 *
 * `db` is a service-role Supabase client and `stripe` a Stripe client.
 */
import { BillingError } from "./errors.js";
import { chargeableMethod } from "./paymentMethods.js";
import { payInvoice, paymentFailureMessage, paymentUnderway, recordPaymentFailure } from "./invoicing.js";
import { lineDescription } from "./invoicePlan.js";
import { leaseLabel } from "./chargeDisplay.js";
import { describeMethod } from "./paymentMethodState.js";

const COLUMNS =
  "id, landlord_id, billing_period, stripe_invoice_id, status, total_cents, invoice_date, due_date, sent_at, collection_method, hosted_invoice_url, invoice_pdf_url, last_failure_message, disputed, autopay_payment_method_id, autopay_scheduled_for, autopay_attempted_at, autopay_skipped_reason";

// When autopay will charge this invoice, or null: scheduled, not yet tried, still unpaid.
export function pendingAutopayDate(row) {
  if (!row.autopay_scheduled_for || row.autopay_attempted_at) return null;
  return row.status === "open" || row.status === "failed" ? row.autopay_scheduled_for : null;
}

export function invoiceView(row) {
  return {
    id: row.id,
    billingPeriod: row.billing_period,
    status: row.status,
    totalCents: row.total_cents,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date ?? null,
    autopayDate: pendingAutopayDate(row),
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
 * The landlord pays their own invoice (Pay now, or Retry payment). `landlordId`
 * is required: it is their click, on their invoice, that allows the charge.
 */
export async function retryInvoicePayment(db, stripe, { invoiceId, landlordId, now = new Date() }) {
  if (!landlordId) throw new BillingError("not_allowed", "Only the landlord can pay their invoice.", 403);
  const { data: row, error } = await db.from("billing_invoices").select(COLUMNS).eq("id", invoiceId).eq("landlord_id", landlordId).maybeSingle();
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

// ── The invoice email ───────────────────────────────────────────────────────

const CHARGE_COLUMNS = `
  id, amount_cents, trigger_type, signed_rent_cents, commission_rate_percent, created_at,
  listing:listings!listing_id(title, address),
  lease:unit_leases!lease_id(lease_term_months, listing_units!unit_id(name, unit_designator, unit_number, bedrooms)),
  student:users!student_id(name)
`;

/*
 * Everything the invoice email needs, read fresh: the invoice, its lines (with
 * signed rent and rate when known), the landlord, and the autopay date if one is
 * still to come. Used by an admin's "Resend invoice email".
 */
export async function invoiceEmailInput(db, invoiceId) {
  const { data: row, error } = await db.from("billing_invoices").select(COLUMNS).eq("id", invoiceId).maybeSingle();
  if (error) throw error;
  if (!row) throw new BillingError("not_found", "Invoice not found.", 404);
  if (!row.invoice_date || !row.stripe_invoice_id) {
    throw new BillingError("not_sent", "This invoice has not been issued yet. Run billing to finish it first.", 409);
  }
  const [{ data: charges, error: chargesError }, { data: landlord, error: userError }] = await Promise.all([
    db.from("charges").select(CHARGE_COLUMNS).eq("invoice_id", row.id).order("created_at", { ascending: true }),
    db.from("users").select("id, name, email").eq("id", row.landlord_id).maybeSingle(),
  ]);
  if (chargesError) throw chargesError;
  if (userError) throw userError;
  if (!landlord?.email) throw new BillingError("no_email", "This landlord has no email address.", 409);

  let autopay = null;
  const date = pendingAutopayDate(row);
  if (date && row.autopay_payment_method_id) {
    const { data: method } = await db
      .from("payment_methods")
      .select("type, brand, last4, exp_month, exp_year, bank_name")
      .eq("id", row.autopay_payment_method_id)
      .maybeSingle();
    if (method) autopay = { scheduledFor: date, methodDescription: describeMethod(method) };
  }

  return {
    landlord,
    invoice: { id: row.id, billing_period: row.billing_period, total_cents: row.total_cents, due_date: row.due_date, hosted_invoice_url: row.hosted_invoice_url, status: row.status },
    lines: (charges ?? []).map((c) => ({
      description: lineDescription({
        trigger_type: c.trigger_type,
        listing_label: c.listing?.address ?? c.listing?.title ?? null,
        lease_label: leaseLabel(c.lease),
        student_name: c.student?.name ?? null,
      }),
      amountCents: c.amount_cents,
      signedRentCents: c.signed_rent_cents,
      commissionRatePercent: c.commission_rate_percent,
    })),
    autopay,
  };
}

// An admin re-sends the invoice email (in place of the removed "Retry payment").
export async function resendInvoiceEmail(db, { invoiceId, notify }) {
  const input = await invoiceEmailInput(db, invoiceId);
  if (!["open", "failed", "processing"].includes(input.invoice.status)) {
    throw new BillingError("not_unpaid", "Only an unpaid invoice can be sent again.", 409);
  }
  const sent = await notify.invoiceIssued(input);
  if (sent === false) throw new BillingError("not_sent", "The email could not be sent. Check the email settings and try again.", 502);
  return { sent: true, to: input.landlord.email };
}
