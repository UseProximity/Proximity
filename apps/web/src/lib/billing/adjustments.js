/*
 * Correcting a Paid charge that turns out to be wrong. The original charge is
 * never edited: the correction is a charge_adjustments row linked to it.
 *
 *   refund   money goes back to the landlord's payment method, through a Stripe
 *            refund on the payment that paid the invoice. The default correction.
 *   credit   a credit on the landlord's Stripe customer balance, which Stripe
 *            takes off their next invoice automatically (a negative balance).
 *
 * The adjustments on one charge never add up to more than the charge. Corrections
 * on one charge run one at a time (a per-charge lock), so two admins correcting
 * the same charge at once cannot both read the same remaining amount and refund
 * more than was paid; the second is told to try again. Each call
 * has a deterministic idempotency key (charge, amount already adjusted, amount),
 * so repeating a request that half-failed returns the same refund or credit
 * instead of making a second.
 *
 * For a credit, charge_adjustments.stripe_refund_id holds the Stripe customer
 * balance transaction id (cbtxn_...); the id's prefix says which kind it is.
 *
 * `db` is a service-role Supabase client and `stripe` a Stripe client.
 */
import { BillingError } from "./errors.js";
import { withSettingsLock } from "./settings.js";

const MAX_REASON_LENGTH = 1000;

async function adjustedSoFar(db, chargeId) {
  const { data, error } = await db.from("charge_adjustments").select("amount_cents").eq("charge_id", chargeId);
  if (error) throw error;
  return data.reduce((sum, a) => sum + a.amount_cents, 0);
}

// The PaymentIntent that paid the invoice, which is what a refund is made against.
async function paymentIntentForInvoice(stripe, stripeInvoiceId) {
  const invoice = await stripe.invoices.retrieve(stripeInvoiceId, { expand: ["payments"] });
  const paid = invoice.payments?.data?.find((p) => p.status === "paid" && p.payment?.payment_intent);
  const id = paid?.payment?.payment_intent;
  if (!id) throw new BillingError("no_payment", "No payment was found on this invoice to refund.", 409);
  return typeof id === "string" ? id : id.id;
}

export async function adjustPaidCharge(db, stripe, { chargeId, adminId, kind, amountCents, reason }) {
  if (kind !== "refund" && kind !== "credit") {
    throw new BillingError("bad_kind", "A correction is a refund or a credit.");
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new BillingError("bad_amount", "Enter an amount in dollars, like 25.00.");
  }
  const why = String(reason ?? "").trim();
  if (!why) throw new BillingError("note_required", "A reason is required.");
  if (why.length > MAX_REASON_LENGTH) {
    throw new BillingError("reason_too_long", `Keep the reason under ${MAX_REASON_LENGTH} characters.`);
  }

  const { data: charge, error } = await db
    .from("charges")
    .select("id, landlord_id, status, amount_cents, invoice_id")
    .eq("id", chargeId)
    .maybeSingle();
  if (error) throw error;
  if (!charge) throw new BillingError("not_found", "Charge not found.", 404);
  if (charge.status !== "paid") {
    throw new BillingError("not_paid", "Only a Paid charge can be refunded or credited. Void or resolve it instead.", 409);
  }

  return withSettingsLock(
    db,
    {
      key: `adjust_lock:${chargeId}`,
      staleMs: 2 * 60 * 1000,
      busyMessage: "Someone else is correcting this charge right now. Refresh and check what is left before trying again.",
    },
    () => adjustUnderLock(db, stripe, { charge, chargeId, adminId, kind, amountCents, why })
  );
}

async function adjustUnderLock(db, stripe, { charge, chargeId, adminId, kind, amountCents, why }) {
  // Read inside the lock, so it includes any correction that just finished.
  const already = await adjustedSoFar(db, chargeId);
  const remaining = charge.amount_cents - already;
  if (amountCents > remaining) {
    throw new BillingError("too_much", `At most ${remaining} cents can still be adjusted on this charge.`, 409);
  }

  const key = `adjust:${kind}:${chargeId}:${already}:${amountCents}`;
  let stripeId;
  if (kind === "refund") {
    const { data: invoice, error: invError } = await db
      .from("billing_invoices")
      .select("stripe_invoice_id")
      .eq("id", charge.invoice_id)
      .maybeSingle();
    if (invError) throw invError;
    if (!invoice?.stripe_invoice_id) throw new BillingError("no_payment", "This charge has no Stripe invoice to refund.", 409);
    const paymentIntent = await paymentIntentForInvoice(stripe, invoice.stripe_invoice_id);
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntent,
        amount: amountCents,
        metadata: { charge_id: chargeId, reason: why.slice(0, 400) },
      },
      { idempotencyKey: key }
    );
    stripeId = refund.id;
  } else {
    const { data: account, error: accError } = await db
      .from("billing_accounts")
      .select("stripe_customer_id")
      .eq("user_id", charge.landlord_id)
      .maybeSingle();
    if (accError) throw accError;
    if (!account?.stripe_customer_id) throw new BillingError("no_account", "This landlord has no Stripe customer.", 409);
    const entry = await stripe.customers.createBalanceTransaction(
      account.stripe_customer_id,
      {
        amount: -amountCents, // negative = credit to the landlord, applied to their next invoice
        currency: "usd",
        description: `Credit: ${why.slice(0, 200)}`,
        metadata: { charge_id: chargeId },
      },
      { idempotencyKey: key }
    );
    stripeId = entry.id;
  }

  const { data: adjustment, error: insertError } = await db
    .from("charge_adjustments")
    .insert({
      charge_id: chargeId,
      kind,
      amount_cents: amountCents,
      reason: why,
      stripe_refund_id: stripeId,
      created_by_id: adminId,
    })
    .select("id, kind, amount_cents, stripe_refund_id, created_at")
    .single();
  if (insertError) {
    // The same correction was already recorded (a repeated request): that is the answer.
    if (insertError.code === "23505") {
      const { data: existing } = await db
        .from("charge_adjustments")
        .select("id, kind, amount_cents, stripe_refund_id, created_at")
        .eq("stripe_refund_id", stripeId)
        .single();
      return { ...existing, repeated: true };
    }
    throw insertError;
  }
  return adjustment;
}

// Recent Paid charges with what has been adjusted on each, for the admin's correction screen.
export async function listPaidCharges(db, { limit = 200 } = {}) {
  const { data, error } = await db
    .from("charges")
    .select(
      `id, amount_cents, trigger_type, paid_at, invoice_id,
       landlord:users!landlord_id(name, email),
       listing:listings!listing_id(title, address),
       adjustments:charge_adjustments(kind, amount_cents)`
    )
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((c) => {
    const adjustedCents = (c.adjustments ?? []).reduce((s, a) => s + a.amount_cents, 0);
    return {
      id: c.id,
      amountCents: c.amount_cents,
      triggerType: c.trigger_type,
      paidAt: c.paid_at,
      listingLabel: c.listing?.address ?? c.listing?.title ?? null,
      landlord: { name: c.landlord?.name ?? null, email: c.landlord?.email ?? null },
      adjustedCents,
      remainingCents: c.amount_cents - adjustedCents,
    };
  });
}
