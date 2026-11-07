/*
 * Webhook handlers for invoice and payment events, registered in
 * webhookHandlers.js. Stripe is the source of truth for whether an invoice was
 * paid, so charges move to Paid here and only here. Each handler is safe to run
 * twice for one event (see webhookEvents.js).
 *
 *   invoice.paid                     row Paid, its charges Paid, the method that paid usable again
 *                                    (only that one), the landlord emailed a receipt, and an
 *                                    autopay charge resets autopay's failure count
 *   invoice.payment_failed           row Failed, landlord and team told once, the method marked Failed;
 *                                    an autopay charge that failed (a bank payment can fail days
 *                                    later) counts toward switching autopay off
 *   invoice.payment_action_required  the bank needs the landlord to confirm: treated as a failure with that message
 *   payment_intent.processing        an ACH payment started and is settling: row Processing
 *   invoice.voided                   row Void; its charges go back to Approved for the next run
 *   invoice.marked_uncollectible     row Uncollectible
 *   charge.dispute.created           a chargeback: recorded, the invoice flagged, the team emailed
 *   charge.dispute.closed            the dispute's outcome is stored
 *
 * Only invoices this app created have a billing_invoices row; any other Stripe
 * invoice is ignored. In this API version a PaymentIntent does not name its
 * invoice, so payment events find it through invoicePayments.
 */
import { getStripe } from "./stripe.js";
import { transitionCharge } from "./charges.js";
import { paymentFailureMessage, recordPaymentFailure } from "./invoicing.js";
import { displayFields, markPaymentMethodFailed } from "./paymentMethods.js";
import { describeMethod } from "./paymentMethodState.js";
import { noteAutopayFailure, noteAutopaySuccess } from "./autopay.js";

const idOf = (v) => (v && typeof v === "object" ? v.id : v) ?? null;
const UNIQUE_VIOLATION = "23505";

async function localInvoice(db, stripeInvoiceId) {
  if (!stripeInvoiceId) return null;
  const { data, error } = await db
    .from("billing_invoices")
    .select("id, landlord_id, billing_period, status, total_cents, hosted_invoice_url, autopay_payment_method_id, autopay_attempted_at, autopay_skipped_reason")
    .eq("stripe_invoice_id", stripeInvoiceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// The Stripe invoice a PaymentIntent paid, or null.
export async function stripeInvoiceIdForPaymentIntent(stripe, paymentIntentId) {
  if (!paymentIntentId) return null;
  const list = await stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    limit: 1,
  });
  return idOf(list.data[0]?.invoice);
}

// Stripe's own wording for why the latest attempt failed, and the method it was tried on.
async function latestFailure(stripe, stripeInvoiceId) {
  try {
    const invoice = await stripe.invoices.retrieve(stripeInvoiceId, { expand: ["payments"] });
    const paymentIntentId = invoice.payments?.data?.map((p) => p.payment?.payment_intent).find(Boolean);
    if (!paymentIntentId) return { message: null, paymentMethodId: null };
    const pi = await stripe.paymentIntents.retrieve(idOf(paymentIntentId));
    return {
      message: pi.last_payment_error?.message ?? null,
      paymentMethodId: pi.last_payment_error?.payment_method?.id ?? idOf(pi.payment_method),
    };
  } catch {
    return { message: null, paymentMethodId: null };
  }
}

async function notifier() {
  // Loaded when needed: the senders use the app's `@/` imports, which the unit tests do not resolve.
  const { billingNotify } = await import("./billingNotify.js");
  return billingNotify();
}

/*
 * The method that paid a Stripe invoice: its Stripe id and how to describe it
 * ("Visa ending 4242"), or null when it cannot be read. It may be one the
 * landlord saved with us or one typed on Stripe's invoice page.
 */
export async function paidWith(stripe, stripeInvoiceId) {
  try {
    const invoice = await stripe.invoices.retrieve(stripeInvoiceId, { expand: ["payments"] });
    const paid = invoice.payments?.data?.find((p) => p.status === "paid" && p.payment?.payment_intent);
    if (!paid) return null;
    const pi = await stripe.paymentIntents.retrieve(idOf(paid.payment.payment_intent), { expand: ["payment_method"] });
    const pm = pi.payment_method;
    if (!pm) return null;
    const fields = typeof pm === "object" ? displayFields(pm) : null;
    return { id: idOf(pm), description: fields ? describeMethod({ ...fields, exp_month: null, exp_year: null }) : null };
  } catch {
    return null;
  }
}

/*
 * An invoice was paid: the row and its charges move to Paid. Called by the
 * invoice.paid webhook, and straight after a Pay now that Stripe confirmed at
 * once (a card), so the landlord sees Paid without waiting for the webhook.
 * Whichever runs second finds it Paid already. Only the call that moved it to
 * Paid emails the receipt, so the landlord gets exactly one.
 *
 * Only the method that paid is proven to work again. A bank that failed stays
 * Failed when the landlord paid with another card (Simão's PY5/PY6, 2026-11-07):
 * before, any payment brought the default back to Active, so the broken bank
 * looked fine and the next invoice failed on it again.
 * Returns true when this call moved the invoice to Paid.
 */
export async function settleInvoicePaid(db, stripe, row, stripeInvoice, { notify = null } = {}) {
  const { data: moved, error } = await db
    .from("billing_invoices")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      hosted_invoice_url: stripeInvoice.hosted_invoice_url ?? row.hosted_invoice_url ?? null,
      invoice_pdf_url: stripeInvoice.invoice_pdf ?? null,
    })
    .eq("id", row.id)
    .neq("status", "paid")
    .select("id");
  if (error) throw error;

  const { data: charges, error: chargesError } = await db
    .from("charges")
    .select("id")
    .eq("invoice_id", row.id)
    .eq("status", "invoiced");
  if (chargesError) throw chargesError;
  for (const { id } of charges) {
    try {
      await transitionCharge(db, { chargeId: id, expectedFrom: "invoiced", to: "paid", actorType: "system" });
    } catch (err) {
      if (err?.code !== "status_changed" && err?.code !== "not_allowed") throw err;
    }
  }

  const method = await paidWith(stripe, stripeInvoice.id);
  if (method?.id) {
    const { error: methodError } = await db
      .from("payment_methods")
      .update({ status: "active" })
      .eq("user_id", row.landlord_id)
      .eq("stripe_payment_method_id", method.id)
      .eq("status", "failed")
      .is("deleted_at", null);
    if (methodError) throw methodError;
  }

  const first = (moved?.length ?? 0) > 0;
  if (first && notify?.invoicePaid) {
    const { data: landlord } = await db.from("users").select("id, name, email").eq("id", row.landlord_id).maybeSingle();
    if (landlord?.email) {
      await notify.invoicePaid({
        landlord,
        invoice: { ...row, invoice_pdf_url: stripeInvoice.invoice_pdf ?? null },
        methodDescription: method?.description ?? null,
      });
    }
  }
  return first;
}

// Autopay tried this invoice (not skipped it).
const autopayCharged = (row) => !!row.autopay_attempted_at && !row.autopay_skipped_reason;

// Whether a failed payment on this invoice was autopay's: autopay tried it, with the method that failed.
async function failedOnAutopayMethod(db, row, stripePaymentMethodId) {
  if (!autopayCharged(row) || !row.autopay_payment_method_id) return false;
  const { data, error } = await db.from("payment_methods").select("stripe_payment_method_id").eq("id", row.autopay_payment_method_id).maybeSingle();
  if (error) throw error;
  return !!data && (!stripePaymentMethodId || data.stripe_payment_method_id === stripePaymentMethodId);
}

async function setInvoiceStatus(db, row, status, onlyFrom) {
  let q = db.from("billing_invoices").update({ status }).eq("id", row.id);
  q = onlyFrom ? q.in("status", onlyFrom) : q.neq("status", "paid");
  const { error } = await q;
  if (error) throw error;
}

export const invoiceHandlers = {
  "invoice.paid": async (event, { db }) => {
    const row = await localInvoice(db, event.data.object.id);
    if (!row) return;
    await settleInvoicePaid(db, getStripe(), row, event.data.object, { notify: await notifier() });
    if (autopayCharged(row)) await noteAutopaySuccess(db, { landlordId: row.landlord_id });
  },

  "invoice.payment_failed": async (event, { db }) => {
    const stripe = getStripe();
    const row = await localInvoice(db, event.data.object.id);
    if (!row) return;
    const failure = await latestFailure(stripe, event.data.object.id);
    if (failure.paymentMethodId) await markPaymentMethodFailed(db, failure.paymentMethodId);
    const notify = await notifier();
    const recorded = await recordPaymentFailure(db, {
      invoiceId: row.id,
      message: paymentFailureMessage({ message: failure.message }),
      notify,
    });
    // Only the call that recorded the failure counts it, so the cron's own record of
    // a card decline and this webhook for the same decline count once.
    if (recorded && (await failedOnAutopayMethod(db, row, failure.paymentMethodId))) {
      await noteAutopayFailure(db, { landlordId: row.landlord_id, notify });
    }
  },

  "invoice.payment_action_required": async (event, { db }) => {
    const row = await localInvoice(db, event.data.object.id);
    if (!row) return;
    await recordPaymentFailure(db, {
      invoiceId: row.id,
      message: "Your bank needs you to confirm this payment. Open the invoice to complete it.",
      notify: await notifier(),
    });
  },

  "payment_intent.processing": async (event, { db }) => {
    const stripeInvoiceId = await stripeInvoiceIdForPaymentIntent(getStripe(), event.data.object.id);
    const row = await localInvoice(db, stripeInvoiceId);
    if (!row) return;
    const { error } = await db
      .from("billing_invoices")
      .update({ status: "processing", processing_started_at: new Date().toISOString() })
      .eq("id", row.id)
      .in("status", ["open", "failed"]);
    if (error) throw error;
  },

  "invoice.voided": async (event, { db }) => {
    const row = await localInvoice(db, event.data.object.id);
    if (!row || row.status === "paid") return;
    await setInvoiceStatus(db, row, "void");
    // Not collected after all: the charges go back to Approved and ride the next run.
    const { data: charges, error } = await db.from("charges").select("id").eq("invoice_id", row.id).eq("status", "invoiced");
    if (error) throw error;
    for (const { id } of charges) {
      try {
        await transitionCharge(db, { chargeId: id, expectedFrom: "invoiced", to: "approved", actorType: "system" });
      } catch (err) {
        if (err?.code !== "status_changed" && err?.code !== "not_allowed") throw err;
      }
    }
  },

  "invoice.marked_uncollectible": async (event, { db }) => {
    const row = await localInvoice(db, event.data.object.id);
    if (row) await setInvoiceStatus(db, row, "uncollectible");
  },

  "charge.dispute.created": async (event, { db }) => {
    const stripe = getStripe();
    const dispute = event.data.object;
    let paymentIntentId = idOf(dispute.payment_intent);
    if (!paymentIntentId && dispute.charge) {
      paymentIntentId = idOf((await stripe.charges.retrieve(idOf(dispute.charge))).payment_intent);
    }
    const row = await localInvoice(db, await stripeInvoiceIdForPaymentIntent(stripe, paymentIntentId));

    // Flag the invoice before recording the dispute. The dispute row is what stops a
    // redelivery from doing this twice, so if it were written first and the flag then
    // failed, the redelivery would stop at the duplicate and the invoice would never
    // be flagged nor the team emailed. Flagging is safe to repeat.
    if (row) {
      const { error: flagError } = await db.from("billing_invoices").update({ disputed: true }).eq("id", row.id);
      if (flagError) throw flagError;
    }

    const { error } = await db.from("billing_disputes").insert({
      invoice_id: row?.id ?? null,
      stripe_dispute_id: dispute.id,
      amount_cents: dispute.amount,
      reason: dispute.reason ?? null,
      status: dispute.status ?? null,
    });
    // Already recorded (a redelivery): nothing more to do, and no second email.
    if (error?.code === UNIQUE_VIOLATION) return;
    if (error) throw error;

    // The dispute is stored; an email problem must not make Stripe redeliver and lose nothing.
    try {
      const { sendChargebackTeamEmail } = await import("./billingEmails.js");
      const { data: landlord } = row
        ? await db.from("users").select("name, email").eq("id", row.landlord_id).maybeSingle()
        : { data: null };
      await sendChargebackTeamEmail({
        landlordName: landlord?.name,
        landlordEmail: landlord?.email,
        amountCents: dispute.amount,
        reason: dispute.reason,
        invoiceId: row?.id ?? null,
      });
    } catch (err) {
      console.error("billing: chargeback email failed", err?.message);
    }
  },

  "charge.dispute.closed": async (event, { db }) => {
    const dispute = event.data.object;
    const { error } = await db
      .from("billing_disputes")
      .update({ status: dispute.status ?? null })
      .eq("stripe_dispute_id", dispute.id);
    if (error) throw error;
  },
};
