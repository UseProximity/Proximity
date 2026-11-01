/*
 * The Stripe side of a monthly invoice, one step per function. Every step is safe
 * to repeat, because the billing run can crash between any two of them and is
 * simply run again:
 *
 *   draft      an invoice is found by its billing key before a new one is made, so
 *              a re-run never opens a second invoice for the same landlord and
 *              month, even after Stripe's own 24 hour idempotency window.
 *   items      each charge becomes one invoice item tagged with its charge id; items
 *              already on the draft are reused, never added twice.
 *   finalize   a draft is finalized; anything else is left alone.
 *   pay        attempted once, by us, with the landlord's default method.
 *
 * Invoices are created with auto_advance off, so Stripe never finalizes, charges
 * or retries one on its own. "A failed payment is not retried automatically" then
 * holds regardless of the dashboard's retry settings: the only attempts are the
 * ones this code (or a landlord's Pay now) makes.
 *
 * `stripe` is a Stripe client, passed in so this stays testable.
 */
import { BillingError } from "./errors.js";

const CURRENCY = "usd";

// "2026-11-01" -> "November 2026"
export function periodLabel(billingPeriod) {
  return new Date(`${billingPeriod}T00:00:00Z`).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function findInvoiceByKey(stripe, customerId, key) {
  for await (const invoice of stripe.invoices.list({ customer: customerId, limit: 100 })) {
    if (invoice.metadata?.billing_key === key) return invoice;
  }
  return null;
}

export async function ensureDraftInvoice(stripe, { customerId, key, landlordId, billingPeriod, localInvoiceId }) {
  const existing = await findInvoiceByKey(stripe, customerId, key);
  if (existing) return existing;
  return stripe.invoices.create(
    {
      customer: customerId,
      collection_method: "charge_automatically",
      auto_advance: false,
      pending_invoice_items_behavior: "exclude",
      currency: CURRENCY,
      description: `Proximity fees for ${periodLabel(billingPeriod)}`,
      payment_settings: { payment_method_types: ["us_bank_account", "card"] },
      metadata: {
        billing_key: key,
        landlord_id: landlordId,
        billing_period: billingPeriod,
        local_invoice_id: localInvoiceId,
      },
    },
    { idempotencyKey: key }
  );
}

// One invoice item per charge. Returns Map(chargeId -> Stripe invoice item id).
export async function ensureInvoiceItems(stripe, { invoice, customerId, lines }) {
  const items = new Map();
  for await (const item of stripe.invoiceItems.list({ invoice: invoice.id, limit: 100 })) {
    if (item.metadata?.charge_id) items.set(item.metadata.charge_id, item.id);
  }
  for (const line of lines) {
    if (items.has(line.chargeId)) continue;
    const created = await stripe.invoiceItems.create(
      {
        customer: customerId,
        invoice: invoice.id,
        amount: line.amountCents,
        currency: CURRENCY,
        description: line.description,
        metadata: { charge_id: line.chargeId },
      },
      { idempotencyKey: `charge-item:${line.chargeId}:${invoice.id}` }
    );
    items.set(line.chargeId, created.id);
  }
  return items;
}

// The draft's total must equal what we are billing, or nothing is finalized.
export async function assertDraftTotal(stripe, invoiceId, expectedCents) {
  const fresh = await stripe.invoices.retrieve(invoiceId);
  if (fresh.total !== expectedCents) {
    throw new BillingError(
      "invoice_mismatch",
      `Invoice total ${fresh.total} does not match the ${expectedCents} being billed.`,
      500
    );
  }
  return fresh;
}

export function finalizeInvoice(stripe, invoiceId) {
  return stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: false });
}

// Pay with a specific method (the landlord's default). One attempt, no retries.
export function payInvoice(stripe, invoiceId, paymentMethodId) {
  return stripe.invoices.pay(invoiceId, { payment_method: paymentMethodId, off_session: true });
}

const NEEDS_ACTION_MESSAGE = "Your bank needs you to confirm this payment. Open the invoice to complete it.";

/*
 * The reason to show a landlord when paying an invoice failed. A decline already
 * reads fine ("Your card was declined."), but a payment that needs the cardholder
 * to authenticate comes back in Stripe's developer wording about client secrets,
 * so that one is replaced with what the landlord should actually do.
 */
export function paymentFailureMessage(err) {
  const text = String(err?.message ?? "");
  const needsAction =
    err?.code === "invoice_payment_intent_requires_action" ||
    err?.code === "authentication_required" ||
    /requires additional action|next_action|client_secret/i.test(text);
  if (needsAction) return NEEDS_ACTION_MESSAGE;
  return text || "The payment did not go through.";
}

/*
 * Record that paying an invoice failed, and tell the landlord and the team, once.
 * Idempotent: an invoice already Failed is left alone and nobody is emailed
 * again, so the synchronous failure in the billing run and the later
 * invoice.payment_failed webhook can both call this for the same failure.
 * Returns true when this call is the one that recorded it.
 */
export async function recordPaymentFailure(db, { invoiceId, message, notify, now = new Date() }) {
  const { data, error } = await db
    .from("billing_invoices")
    .update({ status: "failed", failed_at: now.toISOString(), last_failure_message: String(message ?? "").slice(0, 500) })
    .eq("id", invoiceId)
    .neq("status", "failed")
    .in("status", ["open", "processing"])
    .select("id, landlord_id, total_cents, invoice_date, hosted_invoice_url")
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;

  if (notify?.paymentFailed) {
    const { data: landlord } = await db.from("users").select("id, name, email").eq("id", data.landlord_id).maybeSingle();
    await notify.paymentFailed({ invoice: data, landlord, message });
  }
  return true;
}
