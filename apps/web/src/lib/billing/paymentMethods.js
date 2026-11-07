/*
 * A landlord's payment methods. Card and bank details are entered only on
 * Stripe's hosted page (Checkout in setup mode), so Proximity never sees them:
 * the payment_methods table holds Stripe's id plus display fields (brand, last
 * four, expiry, bank name) and a status.
 *
 *   verifying  a bank account awaiting verification
 *   active     usable
 *   failed     the last payment with it failed, or its verification failed
 *   expired    derived at read time for a card past its expiry (paymentMethodState.js)
 *
 * Two things feed this table: the return from Checkout and the Stripe webhooks.
 * Both go through recordPaymentMethod, which is idempotent, so whichever arrives
 * first wins and the other changes nothing.
 *
 * The default method is the one invoices are charged to. It is mirrored onto the
 * Stripe customer (invoice_settings.default_payment_method), because Stripe is
 * what actually collects the invoice.
 *
 * `db` is a service-role Supabase client and `stripe` a Stripe client, passed in
 * so this stays testable.
 */
import { BillingError } from "./errors.js";
import { userIdForCustomer } from "./customers.js";
import { describeMethod, effectiveStatus, needsAttention } from "./paymentMethodState.js";
import { lazyAutopayNotify, revokeAutopayForMethod } from "./autopay.js";

const LIVE_COLUMNS =
  "id, user_id, stripe_payment_method_id, type, status, is_default, brand, last4, exp_month, exp_year, bank_name, created_at";

// ── Checkout ────────────────────────────────────────────────────────────────

export const SETUP_TYPES = ["us_bank_account", "card"];

// The Checkout Session that collects one payment method. One type per session so
// the page can show the bank account first, as the recommended option, without
// depending on how Stripe orders the choices.
export function setupSessionParams({ customerId, userId, type, baseUrl }) {
  if (!SETUP_TYPES.includes(type)) throw new BillingError("bad_type", "Unsupported payment method type.");
  const back = `${baseUrl}/dashboard/landlord?tab=billing`;
  return {
    mode: "setup",
    customer: customerId,
    currency: "usd",
    allowed_payment_method_types: [type],
    success_url: `${back}&setup=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}&setup=cancelled`,
    metadata: { user_id: userId },
    setup_intent_data: { metadata: { user_id: userId } },
    ...(type === "us_bank_account" && {
      payment_method_options: {
        us_bank_account: {
          // Instant verification through Financial Connections, with microdeposits as the fallback.
          financial_connections: { permissions: ["payment_method"] },
          verification_method: "automatic",
        },
      },
    }),
  };
}

// ── Mapping Stripe objects to rows ──────────────────────────────────────────

export function statusForSetupIntent(status) {
  if (status === "succeeded") return "active";
  if (status === "requires_action" || status === "processing") return "verifying";
  return "failed";
}

// The stored fields for a Stripe PaymentMethod. Null for a type we do not support.
export function displayFields(pm) {
  if (pm.type === "card") {
    return {
      type: "card",
      brand: pm.card?.brand ?? null,
      last4: pm.card?.last4 ?? null,
      exp_month: pm.card?.exp_month ?? null,
      exp_year: pm.card?.exp_year ?? null,
      bank_name: null,
    };
  }
  if (pm.type === "us_bank_account") {
    return {
      type: "us_bank_account",
      brand: null,
      last4: pm.us_bank_account?.last4 ?? null,
      exp_month: null,
      exp_year: null,
      bank_name: pm.us_bank_account?.bank_name ?? null,
    };
  }
  return null;
}

const idOf = (v) => (v && typeof v === "object" ? v.id : v) ?? null;

// ── Recording ───────────────────────────────────────────────────────────────

/*
 * Save (or refresh) a payment method for the landlord who owns `customerId`.
 * Safe to call any number of times, in any order:
 *   - an unknown customer or unsupported type is skipped
 *   - a method the landlord already removed is never revived
 *   - an Active method is not knocked back to Verifying by a late, older event
 */
export async function recordPaymentMethod(db, stripe, { customerId, paymentMethod, status }) {
  const userId = await userIdForCustomer(db, customerId);
  if (!userId) return { skipped: "unknown_customer" };

  const pm = typeof paymentMethod === "string" ? await stripe.paymentMethods.retrieve(paymentMethod) : paymentMethod;
  const fields = displayFields(pm);
  if (!fields) return { skipped: "unsupported_type" };

  const { data: existing, error: readError } = await db
    .from("payment_methods")
    .select("id, status, deleted_at")
    .eq("stripe_payment_method_id", pm.id)
    .maybeSingle();
  if (readError) throw readError;
  if (existing?.deleted_at) return { skipped: "removed" };

  const finalStatus = existing?.status === "active" && status === "verifying" ? "active" : status;
  const { error } = await db
    .from("payment_methods")
    .upsert(
      { user_id: userId, stripe_payment_method_id: pm.id, ...fields, status: finalStatus },
      { onConflict: "stripe_payment_method_id" }
    );
  if (error) throw error;

  await ensureDefault(db, stripe, userId, customerId);
  return { recorded: pm.id, userId, status: finalStatus };
}

const METHOD_STATE_COLUMNS = "id, stripe_payment_method_id, type, status, is_default, brand, last4, bank_name, exp_month, exp_year";

/*
 * Keep the default usable: if there is no default, or the default has failed or
 * expired, the oldest usable method becomes the default. A usable default is
 * never changed. Returns the default after any change (null when nothing is usable).
 */
async function ensureDefault(db, stripe, userId, customerId, now = new Date()) {
  const { data: live, error } = await db
    .from("payment_methods")
    .select(METHOD_STATE_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const current = live.find((m) => m.is_default);
  if (current && effectiveStatus(current, now) === "active") return current;
  const next = live.find((m) => effectiveStatus(m, now) === "active");
  if (next && customerId) {
    await makeDefault(db, stripe, userId, customerId, next);
    return next;
  }
  return null;
}

async function makeDefault(db, stripe, userId, customerId, method) {
  const { error: clearError } = await db
    .from("payment_methods")
    .update({ is_default: false })
    .eq("user_id", userId)
    .eq("is_default", true)
    .neq("id", method.id);
  if (clearError) throw clearError;
  const { error } = await db.from("payment_methods").update({ is_default: true }).eq("id", method.id);
  if (error) throw error;
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: method.stripe_payment_method_id },
  });
}

// From a SetupIntent: Checkout finished (active, or verifying for a bank account
// that still needs microdeposits), or a verifying bank account later succeeded.
export async function syncSetupIntent(db, stripe, setupIntentId) {
  const si = await stripe.setupIntents.retrieve(setupIntentId);
  const paymentMethod = idOf(si.payment_method);
  if (!paymentMethod) return { skipped: "no_payment_method" };
  return recordPaymentMethod(db, stripe, {
    customerId: idOf(si.customer),
    paymentMethod,
    status: statusForSetupIntent(si.status),
  });
}

/*
 * The landlord came back from Checkout. Syncs straight away rather than waiting
 * for the webhook, so the new method is on the page they land on. The session
 * must belong to this landlord's customer: a session id from anyone else is
 * refused, never recorded.
 */
export async function syncCheckoutSession(db, stripe, { sessionId, userId }) {
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    throw new BillingError("bad_session", "We could not find that setup session.", 404);
  }
  const { data: account, error } = await db
    .from("billing_accounts")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!account || idOf(session.customer) !== account.stripe_customer_id || session.mode !== "setup") {
    throw new BillingError("bad_session", "We could not find that setup session.", 404);
  }
  if (session.status !== "complete" || !session.setup_intent) return { skipped: "not_complete" };
  return syncSetupIntent(db, stripe, idOf(session.setup_intent));
}

/*
 * A bank account whose verification failed, or a method whose last payment
 * failed. `verificationFailed` also switches off autopay on it; a failed payment
 * does not (autopay's own failure count decides, see autopay.js).
 */
export async function markPaymentMethodFailed(db, stripePaymentMethodId, { verificationFailed = false } = {}) {
  if (!stripePaymentMethodId) return;
  const { data, error } = await db
    .from("payment_methods")
    .update({ status: "failed" })
    .eq("stripe_payment_method_id", stripePaymentMethodId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw error;
  if (verificationFailed) {
    for (const { id } of data ?? []) {
      await revokeAutopayForMethod(db, { paymentMethodId: id, reason: "verification", notify: lazyAutopayNotify });
    }
  }
}

// Stripe changed a stored method (expiry, or the card updater issued a new
// number): refresh what we display, keeping the status and default.
export async function refreshDisplayFields(db, pm) {
  const fields = displayFields(pm);
  if (!fields) return;
  const { error } = await db
    .from("payment_methods")
    .update(fields)
    .eq("stripe_payment_method_id", pm.id)
    .is("deleted_at", null);
  if (error) throw error;
}

// ── Reading ─────────────────────────────────────────────────────────────────

export async function listPaymentMethods(db, userId, now = new Date()) {
  const { data, error } = await db
    .from("payment_methods")
    .select(LIVE_COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map((m) => {
    const status = effectiveStatus(m, now);
    return {
      id: m.id,
      type: m.type,
      status,
      isDefault: m.is_default,
      description: describeMethod(m),
      needsAttention: needsAttention(status),
    };
  });
}

// ── Changing ────────────────────────────────────────────────────────────────

async function ownedMethod(db, userId, id) {
  const { data, error } = await db
    .from("payment_methods")
    .select(LIVE_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new BillingError("not_found", "Payment method not found.", 404);
  return data;
}

// The method invoices are charged to: the default one, if it is usable right now.
export async function defaultActiveMethod(db, userId, now = new Date()) {
  const { data, error } = await db
    .from("payment_methods")
    .select("id, type, status, brand, last4, bank_name, exp_month, exp_year, stripe_payment_method_id")
    .eq("user_id", userId)
    .eq("is_default", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data && effectiveStatus(data, now) === "active" ? data : null;
}

/*
 * The method to charge an invoice to, for the billing run and Pay now. The default
 * when it is usable; otherwise the landlord's oldest usable method, which is made
 * the default here and on Stripe (a landlord whose card expired or failed, and who
 * has since added a bank account, is charged to that). Null when nothing is usable.
 */
export async function chargeableMethod(db, stripe, userId, now = new Date()) {
  const current = await defaultActiveMethod(db, userId, now);
  if (current) return current;
  const customerId = await customerIdFor(db, userId);
  return ensureDefault(db, stripe, userId, customerId, now);
}

async function customerIdFor(db, userId) {
  const { data, error } = await db.from("billing_accounts").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data?.stripe_customer_id ?? null;
}

export async function setDefaultPaymentMethod(db, stripe, { userId, id, now = new Date() }) {
  const method = await ownedMethod(db, userId, id);
  if (effectiveStatus(method, now) !== "active") {
    throw new BillingError("not_active", "Only an active payment method can be the default.");
  }
  if (method.is_default) return { id };
  const customerId = await customerIdFor(db, userId);
  if (!customerId) throw new BillingError("no_account", "No billing account found.", 404);
  await makeDefault(db, stripe, userId, customerId, method);
  return { id };
}

/*
 * Soft-delete a method and, if it was the default, hand the default to another
 * Active one (or clear it on Stripe when none is left). Shared by the landlord's
 * Remove button and the payment_method.detached webhook, so a method detached
 * from the Stripe dashboard is handled the same way.
 */
export async function finishRemoval(db, stripe, method) {
  const { error } = await db
    .from("payment_methods")
    .update({ deleted_at: new Date().toISOString(), is_default: false })
    .eq("id", method.id)
    .is("deleted_at", null);
  if (error) throw error;

  // Autopay on this method stops, and the landlord is told how to turn it back on.
  await revokeAutopayForMethod(db, { paymentMethodId: method.id, reason: "removed", notify: lazyAutopayNotify });

  const { data: remaining, error: listError } = await db
    .from("payment_methods")
    .select(METHOD_STATE_COLUMNS)
    .eq("user_id", method.user_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (listError) throw listError;

  if (method.is_default) {
    const customerId = await customerIdFor(db, method.user_id);
    const next = remaining.find((m) => effectiveStatus(m, new Date()) === "active");
    if (customerId && next) await makeDefault(db, stripe, method.user_id, customerId, next);
    else if (customerId) {
      await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: "" } });
    }
  }
  return { remaining: remaining.length };
}

export async function removePaymentMethod(db, stripe, { userId, id }) {
  const method = await ownedMethod(db, userId, id);
  try {
    await stripe.paymentMethods.detach(method.stripe_payment_method_id);
  } catch (err) {
    // Already detached on Stripe's side (dashboard, or a retried request): carry on.
    const gone = err?.code === "resource_missing" || /not attached/i.test(err?.message ?? "");
    if (!gone) throw err;
  }
  const { remaining } = await finishRemoval(db, stripe, method);
  return { removed: id, remaining, wasLast: remaining === 0 };
}

// payment_method.detached: the webhook side of finishRemoval.
export async function removeByStripeId(db, stripe, stripePaymentMethodId) {
  const { data: method, error } = await db
    .from("payment_methods")
    .select(LIVE_COLUMNS)
    .eq("stripe_payment_method_id", stripePaymentMethodId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!method) return { skipped: "unknown_or_removed" };
  return { ...(await finishRemoval(db, stripe, method)), userId: method.user_id };
}
