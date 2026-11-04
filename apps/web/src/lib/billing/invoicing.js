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
 *
 * Invoices are send_invoice (decisions of 2026-11-04): the landlord pays them,
 * due INVOICE_DUE_DAYS after they are sent. Nothing here ever charges a saved
 * method. Money moves only when the landlord presses Pay now, or when autopay,
 * which the landlord switched on with a recorded authorisation, charges it
 * (autopay.js). Invoices are finalized with auto_advance off and Stripe's own
 * "send invoice" is never called, so Stripe neither emails the invoice nor
 * retries anything; our invoice email (billingEmails.sendInvoiceIssuedEmail) is
 * the only one.
 *
 * `stripe` is a Stripe client, passed in so this stays testable.
 */
import { BillingError } from "./errors.js";
import { DAY_MS, INVOICE_DUE_DAYS } from "./constants.js";

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

/*
 * Create the month's draft. The caller has already looked it up by key
 * (findInvoiceByKey pages through every invoice the customer has, so it is done
 * once per landlord, not again here); the idempotency key covers a repeat of this
 * call within Stripe's 24 hours.
 */
export function createDraftInvoice(stripe, { customerId, key, landlordId, billingPeriod, localInvoiceId }) {
  return stripe.invoices.create(
    {
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: INVOICE_DUE_DAYS,
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

/*
 * An invoice that is already finalized and is about to be treated as this
 * landlord's invoice for the month must really be the one we built: the same
 * total, with a line for every charge claimed onto it. Otherwise the charges
 * would be marked Invoiced against an invoice that never billed them. The key
 * alone is not proof, so a mismatch stops the run for that landlord and is
 * reported, rather than being adopted quietly.
 */
export async function assertInvoiceMatches(stripe, invoice, lines, totalCents) {
  if (invoice.total !== totalCents) {
    throw new BillingError(
      "invoice_mismatch",
      `Stripe invoice ${invoice.id} totals ${invoice.total} cents but ${totalCents} is being billed.`,
      500
    );
  }
  const onInvoice = new Set();
  for await (const item of stripe.invoiceItems.list({ invoice: invoice.id, limit: 100 })) {
    if (item.metadata?.charge_id) onInvoice.add(item.metadata.charge_id);
  }
  const missing = lines.filter((l) => !onInvoice.has(l.chargeId));
  if (missing.length) {
    throw new BillingError(
      "invoice_mismatch",
      `Stripe invoice ${invoice.id} has no line for ${missing.length} of the charges being billed.`,
      500
    );
  }
}

export function finalizeInvoice(stripe, invoiceId) {
  return stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: false });
}

/*
 * What the local row should hold once Stripe has finalized the invoice. The
 * invoice date (and sent_at, when our invoice email goes out) is when Stripe
 * finalized it, not when the run started. The due date is Stripe's, or
 * INVOICE_DUE_DAYS after that; the overdue clock counts from it. Also used to
 * fill in a row whose run crashed between finalizing and saving these, so a
 * resumed run never leaves them blank.
 */
export function finalizedFields(invoice, now = new Date()) {
  const finalized = invoice.status_transitions?.finalized_at;
  const issued = finalized ? new Date(finalized * 1000) : now;
  const due = invoice.due_date ? new Date(invoice.due_date * 1000) : new Date(issued.getTime() + INVOICE_DUE_DAYS * DAY_MS);
  return {
    invoice_date: issued.toISOString(),
    sent_at: issued.toISOString(),
    due_date: due.toISOString(),
    collection_method: invoice.collection_method ?? "send_invoice",
    hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    invoice_pdf_url: invoice.invoice_pdf ?? null,
  };
}

const idOf = (v) => (v && typeof v === "object" ? v.id : v) ?? null;

/*
 * Whether a payment on this invoice is already done or under way, checked after
 * Stripe refused a pay call. Stripe refuses to pay an invoice that is already
 * paid or whose ACH payment is still settling, and that is not a failure: the
 * landlord must not be told their payment did not go through while it is.
 * Returns "paid", "processing" or null (a real failure).
 */
export async function paymentUnderway(stripe, invoiceId) {
  let invoice;
  try {
    invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
  } catch {
    return null;
  }
  if (invoice.status === "paid") return "paid";
  const intentIds = (invoice.payments?.data ?? []).map((p) => idOf(p.payment?.payment_intent)).filter(Boolean);
  for (const id of intentIds) {
    try {
      const pi = await stripe.paymentIntents.retrieve(id);
      if (pi.status === "processing" || pi.status === "succeeded") return "processing";
    } catch {
      // An intent we cannot read says nothing either way.
    }
  }
  return null;
}

/*
 * Pay with a specific saved method. Called only for a landlord's Pay now (their
 * click is the consent) and for autopay they authorised. One attempt, no retries.
 * `idempotencyKey` makes a repeated autopay call for the same invoice one charge.
 */
export function payInvoice(stripe, invoiceId, paymentMethodId, { idempotencyKey } = {}) {
  return stripe.invoices.pay(
    invoiceId,
    { payment_method: paymentMethodId, off_session: true },
    ...(idempotencyKey ? [{ idempotencyKey }] : [])
  );
}

const NEEDS_ACTION_MESSAGE = "Your bank needs you to confirm this payment. Open the invoice to complete it.";
const GENERIC_FAILURE = "The payment did not go through.";

// Stripe wording meant for developers: object ids (pm_..., in_...), object names
// and API terms. A message containing any of it is never shown to a landlord.
const DEVELOPER_WORDING =
  /\b(?:pm|pi|in|ii|cus|ch|py|src|seti|card|ba|acct|sub|txn|re|cbtxn)_[A-Za-z0-9]{6,}|\bNo such\b|PaymentMethod|PaymentIntent|SetupIntent|\bAPI\b|parameter|attached|livemode|idempotenc|client_secret|next_action/i;

/*
 * The reason to show a landlord when paying an invoice failed. It is shown on the
 * dashboard, stored and emailed, so it must never carry Stripe internals. A decline
 * reads fine as Stripe words it ("Your card was declined."). A payment that needs
 * the cardholder to authenticate is replaced with what to do. Anything else in
 * developer wording ("No such PaymentMethod: 'pm_...'") becomes a plain sentence.
 */
export function paymentFailureMessage(err) {
  const text = String(err?.message ?? "").trim();
  const needsAction =
    err?.code === "invoice_payment_intent_requires_action" ||
    err?.code === "authentication_required" ||
    /requires additional action|next_action|client_secret/i.test(text);
  if (needsAction) return NEEDS_ACTION_MESSAGE;
  if (!text || DEVELOPER_WORDING.test(text) || text.length > 300) return GENERIC_FAILURE;
  return text;
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
