/*
 * A landlord's invoices, paying one (Pay now, or Retry payment after a failure),
 * and an admin re-sending the invoice email.
 *
 * Paying makes exactly one attempt with the landlord's default active payment
 * method, and only because the landlord pressed the button: that click is their
 * consent (decisions of 2026-11-04). Admins cannot charge a landlord; they can
 * resend the invoice email. Apart from this, only autopay the landlord switched
 * on charges anything (autopay.js). A card answers at once, so a card payment
 * is settled here (Paid, receipt emailed) instead of waiting for the webhook,
 * and a bank payment that started is shown as Processing straight away. The
 * webhooks still arrive and find the work done.
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
import { settleInvoicePaid } from "./invoiceHandlers.js";

const COLUMNS =
  "id, landlord_id, billing_period, stripe_invoice_id, status, total_cents, invoice_date, due_date, sent_at, collection_method, hosted_invoice_url, invoice_pdf_url, last_failure_message, failed_at, disputed, autopay_payment_method_id, autopay_scheduled_for, autopay_attempted_at, autopay_skipped_reason";

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
    // What an admin has since refunded or credited on this invoice's charges.
    refundedCents: adjustedOn(row, "refund"),
    creditedCents: adjustedOn(row, "credit"),
    // A payer's invoice (Project B): what each account they pay for adds, by name.
    accounts: accountsOn(row),
  };
}

function accountsOn(row) {
  const by = new Map();
  for (const c of row.charges ?? []) {
    if (!c.landlord_id || c.landlord_id === row.landlord_id) continue;
    const name = c.account?.company_name?.trim() || c.account?.name || c.account?.email || "Landlord account";
    const prev = by.get(c.landlord_id) ?? { name, totalCents: 0 };
    prev.totalCents += c.amount_cents ?? 0;
    by.set(c.landlord_id, prev);
  }
  if (!by.size) return [];
  const own = (row.charges ?? []).filter((c) => c.landlord_id === row.landlord_id).reduce((n, c) => n + (c.amount_cents ?? 0), 0);
  return [...(own ? [{ name: "Your own listings", totalCents: own }] : []), ...[...by.values()].sort((a, b) => a.name.localeCompare(b.name))];
}

const adjustedOn = (row, kind) =>
  (row.charges ?? []).flatMap((c) => c.adjustments ?? []).filter((a) => a.kind === kind).reduce((sum, a) => sum + a.amount_cents, 0);

export async function listInvoicesForLandlord(db, landlordId) {
  const { data, error } = await db
    .from("billing_invoices")
    .select(`${COLUMNS}, charges:charges!invoice_id(landlord_id, amount_cents, account:users!landlord_id(name, company_name, email), adjustments:charge_adjustments(kind, amount_cents))`)
    .eq("landlord_id", landlordId)
    .order("billing_period", { ascending: false });
  if (error) throw error;
  return data.map(invoiceView);
}

/*
 * The landlord pays their own invoice (Pay now, or Retry payment). `landlordId`
 * is required: it is their click, on their invoice, that allows the charge.
 * `notify` (billingNotify) sends the receipt, or the failed payment emails to
 * the landlord and the team (Wyatt, 2026-11-07: a failed Pay now is emailed too,
 * so the team hears about it and the landlord has a record).
 *
 * Returns { paid: true, method } for a card that went through, { processing:
 * true, method } for a bank payment that started, { alreadyPaid: true }, or
 * { started: true } when Stripe has not said yet. `method` is "card" or "bank".
 */
export async function retryInvoicePayment(db, stripe, { invoiceId, landlordId, notify = null, now = new Date() }) {
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

  /*
   * Stripe has it Paid and the row may not show it yet (the webhook is on its
   * way): settle it here so the invoice reads Paid when the page reloads. The
   * payment already happened, so nothing here may turn it into an error.
   */
  const settle = async (stripeInvoice, paidBy) => {
    try {
      const fresh = stripeInvoice ?? (await stripe.invoices.retrieve(row.stripe_invoice_id));
      await settleInvoicePaid(db, stripe, row, fresh, { notify, paidBy });
    } catch (err) {
      console.error("[billing] settling a paid invoice failed; the webhook will finish it:", err?.message);
    }
  };
  const alreadyPaid = async (stripeInvoice) => {
    await settle(stripeInvoice);
    return { alreadyPaid: true };
  };

  const invoice = await stripe.invoices.retrieve(row.stripe_invoice_id);
  if (invoice.status === "paid") return alreadyPaid(invoice);
  if (invoice.status !== "open") {
    throw new BillingError("not_payable", "This invoice cannot be paid right now.", 409);
  }

  // An ACH payment the run (or an earlier click) started may still be settling
  // before its webhook has marked the row Processing. Paying again would be refused
  // and read as a failure.
  const underway = await paymentUnderway(stripe, invoice.id);
  if (underway === "paid") return alreadyPaid();
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

  const kind = method.type === "card" ? "card" : "bank";
  let result;
  try {
    result = await payInvoice(stripe, invoice.id, method.stripe_payment_method_id);
  } catch (err) {
    const raced = await paymentUnderway(stripe, invoice.id);
    if (raced === "paid") return alreadyPaid();
    if (raced === "processing") return { started: true };
    /*
     * Shown on the invoice at once. The landlord has just seen the decline on
     * screen, so is not emailed about it; the team is, once per invoice (the
     * first failure ever recorded on it). A landlord pressing Retry five times
     * sent ten emails before (2026-11-07).
     */
    const message = paymentFailureMessage(err);
    await recordPaymentFailure(db, { invoiceId: row.id, message, notify, now, tell: row.failed_at ? "none" : "team" });
    throw new BillingError("payment_failed", message, 402);
  }

  // A card is paid now: show it Paid and send the receipt without waiting for the webhook.
  if (result?.status === "paid") {
    // The method is known: no need to ask Stripe which one paid.
    await settle(
      result,
      method.last4
        ? { id: method.stripe_payment_method_id, description: describeMethod({ ...method, exp_month: null, exp_year: null }) }
        : undefined
    );
    return { paid: true, method: kind };
  }
  // A bank payment settles over a few business days: Processing until it does.
  if ((await paymentUnderway(stripe, invoice.id)) === "processing") {
    const { error: processingError } = await db
      .from("billing_invoices")
      .update({ status: "processing", processing_started_at: now.toISOString() })
      .eq("id", row.id)
      // Only from Open, which it was just set to: a failure recorded since then must stand.
      .eq("status", "open");
    if (processingError) throw processingError;
    return { processing: true, method: kind };
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
