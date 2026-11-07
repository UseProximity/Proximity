/*
 * Autopay: a landlord may let Proximity charge their monthly invoice to a saved
 * payment method they choose (decisions of 2026-11-04). Off unless they turn it
 * on; nothing else in billing ever charges a saved method on its own.
 *
 *   Turning it on   the landlord picks one Active saved method (a bank account
 *                   still Verifying cannot be picked) and ticks the authorisation.
 *                   The exact words, the method and their browser are stored in
 *                   autopay_authorizations; one active row per landlord.
 *   Turning it off  the landlord, or an admin (for example at the landlord's
 *                   request), revokes it with a reason. A new consent is a new row.
 *   Scheduling      when an invoice is sent, an invoice of a landlord with autopay
 *                   on gets the method and a date AUTOPAY_BUSINESS_DAYS business
 *                   days later (Chicago, weekends and Fed holidays skipped). The
 *                   invoice email names both.
 *   Charging        the daily cron charges invoices whose date has come, unless
 *                   they were paid meanwhile or autopay was turned off. The row is
 *                   claimed (autopay_attempted_at) before Stripe is called, with a
 *                   per-invoice idempotency key, so a re-run never charges twice.
 *                   A step that fails before Stripe is asked to charge releases
 *                   the claim, so the next run tries again. A claim left behind
 *                   by a crash or a timeout (still open, no skip reason, no
 *                   failure recorded) is taken up again after STALE_CLAIM_HOURS.
 *   Failing         no automatic retry: the invoice becomes a normal unpaid one
 *                   with Pay now, the landlord is emailed, and the failure counts.
 *                   AUTOPAY_MAX_FAILURES in a row switch autopay off (emailed).
 *                   A success resets the count.
 *   Method gone     removed, or a card expired: autopay switches off and the
 *                   landlord is emailed once ("choose a method to turn it back
 *                   on"). A method whose last payment failed keeps autopay: the
 *                   failure count decides.
 *
 * `db` is a service-role Supabase client and `stripe` a Stripe client. `notify`
 * ({ autopayOff, paymentFailed }) sends the emails; pass null to send none.
 */
import { BillingError } from "./errors.js";
import { AUTOPAY_BUSINESS_DAYS, AUTOPAY_MAX_FAILURES } from "./constants.js";
import { addBusinessDays, chicagoDayStart } from "./businessDays.js";
import { describeMethod, effectiveStatus } from "./paymentMethodState.js";
import { payInvoice, paymentFailureMessage, paymentUnderway, recordPaymentFailure } from "./invoicing.js";

const AUTH_COLUMNS = "id, user_id, payment_method_id, consent_text, authorized_at, consecutive_failures, revoked_at, revoked_reason";
const METHOD_COLUMNS = "id, user_id, stripe_payment_method_id, type, status, brand, last4, exp_month, exp_year, bank_name, deleted_at";
const BATCH = 200;
// A claim this old with nothing to show for it was cut short (a crash or a timeout).
const STALE_CLAIM_HOURS = 6;
// Abandoned claims older than this are left for an admin rather than retried.
const STALE_CLAIM_MAX_DAYS = 5;
const UNIQUE_VIOLATION = "23505";

// Why autopay was switched off, in the words the landlord reads.
export const OFF_REASONS = {
  landlord: "you turned it off",
  admin: "Proximity turned it off for you",
  replaced: "you chose a different payment method",
  removed: "the payment method it used was removed",
  expired: "the card it used has expired",
  verification: "the bank account it used could not be verified",
  failures: `the last ${AUTOPAY_MAX_FAILURES} autopay payments did not go through`,
};
// Reasons the landlord did not cause themselves, so they are emailed about.
const EMAILED = new Set(["admin", "removed", "expired", "verification", "failures"]);

// The authorisation the landlord ticks. Stored word for word with their consent.
export function consentText(methodDescription) {
  return (
    `I authorise Proximity to charge ${methodDescription} for the full amount of each monthly Proximity invoice, ` +
    `${AUTOPAY_BUSINESS_DAYS} business days after the invoice is emailed to me, until I turn autopay off. ` +
    "I can turn autopay off at any time on my Billing page."
  );
}

// The date autopay charges an invoice sent at `sentAt`: an instant at the start of that Chicago day.
export function autopayDateFor(sentAt) {
  return chicagoDayStart(addBusinessDays(sentAt, AUTOPAY_BUSINESS_DAYS));
}

// Can this method be chosen for autopay? Active only; Verifying, Failed and Expired cannot.
export function canChooseForAutopay(method, now = new Date()) {
  return !!method && !method.deleted_at && effectiveStatus(method, now) === "active";
}

// Can autopay still charge this method? A Failed one is given its chance (the
// failure count decides); a removed or expired one cannot.
export function methodGoneReason(method, now = new Date()) {
  if (!method || method.deleted_at) return "removed";
  if (effectiveStatus(method, now) === "expired") return "expired";
  return null;
}

async function activeAuthorization(db, userId) {
  const { data, error } = await db
    .from("autopay_authorizations")
    .select(AUTH_COLUMNS)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function methodById(db, id) {
  const { data, error } = await db.from("payment_methods").select(METHOD_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function landlordOf(db, userId) {
  const { data, error } = await db.from("users").select("id, name, email, deleted_at").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

// ── Reading ─────────────────────────────────────────────────────────────────

/*
 * What the landlord's Autopay card shows, and the admin's view of it: whether it
 * is on and with which method, the methods they could choose, and the words they
 * would agree to for each.
 */
export async function autopayState(db, userId, now = new Date()) {
  const [auth, methodsResult] = await Promise.all([
    activeAuthorization(db, userId),
    db.from("payment_methods").select(METHOD_COLUMNS).eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending: true }),
  ]);
  if (methodsResult.error) throw methodsResult.error;
  const methods = methodsResult.data ?? [];
  const method = auth ? methods.find((m) => m.id === auth.payment_method_id) ?? (await methodById(db, auth.payment_method_id)) : null;
  return {
    enabled: !!auth,
    authorizedAt: auth?.authorized_at ?? null,
    consecutiveFailures: auth?.consecutive_failures ?? 0,
    method: method ? { id: method.id, description: describeMethod(method), status: effectiveStatus(method, now) } : null,
    choices: methods
      .filter((m) => canChooseForAutopay(m, now))
      .map((m) => ({ id: m.id, description: describeMethod(m), consentText: consentText(describeMethod(m)) })),
    businessDays: AUTOPAY_BUSINESS_DAYS,
  };
}

// ── Turning it on and off ───────────────────────────────────────────────────

/*
 * The landlord turns autopay on (or moves it to another method). Only the
 * landlord can: there is no admin path to this. `authorized` must be the literal
 * true from their ticked box, and the words stored are built here, never taken
 * from the browser.
 */
export async function enableAutopay(db, { userId, paymentMethodId, authorized, userAgent = null, now = new Date() }) {
  if (authorized !== true) {
    throw new BillingError("authorization_required", "Tick the box to authorise autopay.");
  }
  const method = await methodById(db, paymentMethodId);
  if (!method || method.user_id !== userId || method.deleted_at) {
    throw new BillingError("not_found", "Payment method not found.", 404);
  }
  if (!canChooseForAutopay(method, now)) {
    throw new BillingError(
      "not_active",
      method.status === "verifying"
        ? "This bank account is still being verified. Choose it for autopay once it is active."
        : "Choose an active payment method for autopay."
    );
  }

  const current = await activeAuthorization(db, userId);
  if (current?.payment_method_id === method.id) return { enabled: true, unchanged: true };
  if (current) await revoke(db, current, { reason: "replaced", byId: userId, now });

  const { error } = await db.from("autopay_authorizations").insert({
    user_id: userId,
    payment_method_id: method.id,
    consent_text: consentText(describeMethod(method)),
    authorized_at: now.toISOString(),
    user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new BillingError("status_changed", "Autopay was just changed. Refresh and try again.", 409);
    throw error;
  }
  return { enabled: true };
}

async function revoke(db, auth, { reason, byId = null, now = new Date() }) {
  const { data, error } = await db
    .from("autopay_authorizations")
    .update({ revoked_at: now.toISOString(), revoked_reason: reason, revoked_by_id: byId })
    .eq("id", auth.id)
    .is("revoked_at", null)
    .select(AUTH_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data; // null when someone else revoked it first
}

async function tellOff(db, auth, reason, notify) {
  if (!EMAILED.has(reason) || !notify?.autopayOff) return;
  try {
    const landlord = await landlordOf(db, auth.user_id);
    if (!landlord?.email || landlord.deleted_at) return;
    const method = await methodById(db, auth.payment_method_id);
    await notify.autopayOff({ landlord, reason: OFF_REASONS[reason], methodDescription: method ? describeMethod(method) : null });
  } catch (err) {
    console.error("billing: autopay off email failed", err?.message);
  }
}

/*
 * Turn autopay off. `reason` is a key of OFF_REASONS: "landlord" from their own
 * button (no email), "admin" from the admin dashboard (the landlord is emailed).
 * Returns whether it was on.
 */
export async function disableAutopay(db, { userId, reason = "landlord", byId = null, notify = null, now = new Date() }) {
  const auth = await activeAuthorization(db, userId);
  if (!auth) return { wasOn: false };
  const revoked = await revoke(db, auth, { reason, byId, now });
  if (revoked) await tellOff(db, auth, reason, notify);
  return { wasOn: !!revoked };
}

/*
 * A payment method went away (removed, expired, or its verification failed): if
 * autopay used it, switch autopay off and tell the landlord once.
 * `paymentMethodId` is our row id.
 */
export async function revokeAutopayForMethod(db, { paymentMethodId, reason, notify = null, now = new Date() }) {
  const { data, error } = await db
    .from("autopay_authorizations")
    .select(AUTH_COLUMNS)
    .eq("payment_method_id", paymentMethodId)
    .is("revoked_at", null);
  if (error) throw error;
  let revokedCount = 0;
  for (const auth of data ?? []) {
    if (await revoke(db, auth, { reason, now })) {
      revokedCount += 1;
      await tellOff(db, auth, reason, notify);
    }
  }
  return revokedCount;
}

// ── Scheduling an invoice ───────────────────────────────────────────────────

/*
 * Called when an invoice is sent. With autopay on and its method still there,
 * stamps the invoice with the method and the date it will be charged, and
 * returns { scheduledFor, methodDescription } for the invoice email. Otherwise
 * null (and a method that has gone switches autopay off). Safe to repeat: an
 * invoice already scheduled keeps its date.
 */
export async function scheduleAutopay(db, { invoiceId, landlordId, sentAt, notify = null, now = new Date() }) {
  const auth = await activeAuthorization(db, landlordId);
  if (!auth) return null;
  const method = await methodById(db, auth.payment_method_id);
  const gone = methodGoneReason(method, now);
  if (gone) {
    if (await revoke(db, auth, { reason: gone, now })) await tellOff(db, auth, gone, notify);
    return null;
  }

  const { data: invoice, error: readError } = await db
    .from("billing_invoices")
    .select("id, autopay_scheduled_for, autopay_payment_method_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (readError) throw readError;
  if (!invoice) return null;
  if (invoice.autopay_scheduled_for) {
    const scheduledMethod = invoice.autopay_payment_method_id === method.id ? method : await methodById(db, invoice.autopay_payment_method_id);
    return { scheduledFor: invoice.autopay_scheduled_for, methodDescription: scheduledMethod ? describeMethod(scheduledMethod) : describeMethod(method) };
  }

  const scheduledFor = autopayDateFor(sentAt).toISOString();
  const { error } = await db
    .from("billing_invoices")
    .update({ autopay_payment_method_id: method.id, autopay_scheduled_for: scheduledFor })
    .eq("id", invoiceId)
    .is("autopay_scheduled_for", null);
  if (error) throw error;
  return { scheduledFor, methodDescription: describeMethod(method) };
}

// ── Counting outcomes ───────────────────────────────────────────────────────

/*
 * An autopay charge failed (the cron's own attempt, or a bank payment it started
 * that failed later). Counted once per failure by the callers, which only call
 * this when recordPaymentFailure recorded the failure. AUTOPAY_MAX_FAILURES in a
 * row switch autopay off.
 */
export async function noteAutopayFailure(db, { landlordId, notify = null, now = new Date() }) {
  const auth = await activeAuthorization(db, landlordId);
  if (!auth) return { counted: false };
  const failures = (auth.consecutive_failures ?? 0) + 1;
  const { error } = await db.from("autopay_authorizations").update({ consecutive_failures: failures }).eq("id", auth.id).is("revoked_at", null);
  if (error) throw error;
  if (failures >= AUTOPAY_MAX_FAILURES) {
    if (await revoke(db, auth, { reason: "failures", now })) await tellOff(db, auth, "failures", notify);
    return { counted: true, failures, switchedOff: true };
  }
  return { counted: true, failures, switchedOff: false };
}

// An invoice autopay charged was paid: the failure count starts again.
export async function noteAutopaySuccess(db, { landlordId }) {
  const { error } = await db
    .from("autopay_authorizations")
    .update({ consecutive_failures: 0 })
    .eq("user_id", landlordId)
    .is("revoked_at", null)
    .gt("consecutive_failures", 0);
  if (error) throw error;
}

// ── The daily job ───────────────────────────────────────────────────────────

/*
 * Switch off autopay whose method has been removed or has expired, emailing each
 * landlord once. Removal is also caught straight away (paymentMethods.finishRemoval);
 * an expiry only shows with the passing of time, so it is caught here.
 */
export async function sweepAutopayMethods(db, { notify = null, now = new Date() } = {}) {
  const { data, error } = await db.from("autopay_authorizations").select(AUTH_COLUMNS).is("revoked_at", null).limit(1000);
  if (error) throw error;
  let switchedOff = 0;
  for (const auth of data ?? []) {
    const gone = methodGoneReason(await methodById(db, auth.payment_method_id), now);
    if (!gone) continue;
    if (await revoke(db, auth, { reason: gone, now })) {
      switchedOff += 1;
      await tellOff(db, auth, gone, notify);
    }
  }
  return switchedOff;
}

async function skip(db, invoiceId, reason) {
  const { error } = await db.from("billing_invoices").update({ autopay_skipped_reason: reason }).eq("id", invoiceId);
  if (error) throw error;
  return reason;
}

// Charge one invoice whose autopay date has come. Returns what happened.
async function chargeOne(db, stripe, row, { notify, now }) {
  // Claim it first: a second run, or a run racing this one, finds it taken. A
  // stale claim is taken over only if it is still the one this run saw.
  const stamp = now.toISOString();
  let claim = db.from("billing_invoices").update({ autopay_attempted_at: stamp }).eq("id", row.id);
  claim = row.autopay_attempted_at ? claim.eq("autopay_attempted_at", row.autopay_attempted_at) : claim.is("autopay_attempted_at", null);
  const { data: claimed, error: claimError } = await claim
    .select("id, landlord_id, status, stripe_invoice_id, autopay_payment_method_id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return "taken";

  try {
    return await chargeClaimed(db, stripe, row, claimed, { notify, now });
  } catch (err) {
    // Nothing was charged and nothing recorded: let the next run try again.
    if (!err?.afterCharge) {
      await db
        .from("billing_invoices")
        .update({ autopay_attempted_at: null })
        .eq("id", row.id)
        .eq("autopay_attempted_at", stamp)
        .is("autopay_skipped_reason", null);
    }
    throw err;
  }
}

async function chargeClaimed(db, stripe, row, claimed, { notify, now }) {
  if (claimed.status === "paid" || claimed.status === "processing") return skip(db, row.id, "already paid");
  if (!["open", "failed"].includes(claimed.status) || !claimed.stripe_invoice_id) return skip(db, row.id, "not payable");

  // Autopay must still be on, with the same method the invoice email named.
  const auth = await activeAuthorization(db, claimed.landlord_id);
  if (!auth) return skip(db, row.id, "autopay turned off");
  if (auth.payment_method_id !== claimed.autopay_payment_method_id) return skip(db, row.id, "autopay method changed");
  const method = await methodById(db, auth.payment_method_id);
  const gone = methodGoneReason(method, now);
  if (gone) {
    if (await revoke(db, auth, { reason: gone, now })) await tellOff(db, auth, gone, notify);
    return skip(db, row.id, `payment method ${gone}`);
  }

  const invoice = await stripe.invoices.retrieve(claimed.stripe_invoice_id);
  if (invoice.status === "paid") return skip(db, row.id, "already paid");
  if (invoice.status !== "open") return skip(db, row.id, "not payable");
  const underway = await paymentUnderway(stripe, invoice.id);
  if (underway) return skip(db, row.id, "already paid");

  // A landlord's own Pay now that failed left it Failed; back to Open so this failure is recorded afresh.
  if (claimed.status === "failed") {
    const { error } = await db.from("billing_invoices").update({ status: "open" }).eq("id", row.id).eq("status", "failed");
    if (error) throw error;
  }

  try {
    await payInvoice(stripe, invoice.id, method.stripe_payment_method_id, { idempotencyKey: `autopay:${invoice.id}` });
  } catch (err) {
    try {
      const raced = await paymentUnderway(stripe, invoice.id);
      if (raced) return "charged";
      const recorded = await recordPaymentFailure(db, { invoiceId: row.id, message: paymentFailureMessage(err), notify, now });
      if (recorded) await noteAutopayFailure(db, { landlordId: claimed.landlord_id, notify, now });
    } catch (inner) {
      // Stripe was already asked to charge: the claim stays (the stale-claim
      // sweep picks it up only if no failure was recorded and it is still open).
      inner.afterCharge = true;
      throw inner;
    }
    return "failed";
  }
  // A card is paid at once; a bank payment is processing and reports by webhook.
  const after = await stripe.invoices.retrieve(invoice.id).catch(() => null);
  if (after?.status === "paid") {
    try {
      await noteAutopaySuccess(db, { landlordId: claimed.landlord_id });
    } catch (err) {
      err.afterCharge = true;
      throw err;
    }
  }
  return "charged";
}

/*
 * Charge every invoice whose autopay date has come. Safe to run any number of
 * times a day. One invoice failing never stops the others.
 */
export async function runAutopayJob(db, stripe, { now = new Date(), notify = null } = {}) {
  const result = { switchedOff: 0, due: 0, charged: 0, failed: 0, skipped: 0, errors: [] };
  result.switchedOff = await sweepAutopayMethods(db, { notify, now });

  const { data: due, error } = await db
    .from("billing_invoices")
    .select("id")
    .in("status", ["open", "failed", "processing", "paid"])
    .is("autopay_attempted_at", null)
    .not("autopay_scheduled_for", "is", null)
    .lte("autopay_scheduled_for", now.toISOString())
    .order("autopay_scheduled_for", { ascending: true })
    .limit(BATCH);
  if (error) throw error;

  // Claims cut short by a crash or a timeout: still open, never skipped, no failure on record.
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_HOURS * 3600 * 1000).toISOString();
  const staleAfter = new Date(now.getTime() - STALE_CLAIM_MAX_DAYS * 86400 * 1000).toISOString();
  const { data: stale, error: staleError } = await db
    .from("billing_invoices")
    .select("id, autopay_attempted_at")
    .eq("status", "open")
    .is("autopay_skipped_reason", null)
    .is("failed_at", null)
    .not("autopay_scheduled_for", "is", null)
    .lt("autopay_attempted_at", staleBefore)
    .gt("autopay_attempted_at", staleAfter)
    .limit(BATCH);
  if (staleError) throw staleError;

  for (const row of [...(due ?? []), ...(stale ?? [])]) {
    result.due += 1;
    try {
      const outcome = await chargeOne(db, stripe, row, { notify, now });
      if (outcome === "charged") result.charged += 1;
      else if (outcome === "failed") result.failed += 1;
      else if (outcome !== "taken") result.skipped += 1;
    } catch (err) {
      result.errors.push({ invoiceId: row.id, error: String(err?.message ?? err).slice(0, 200) });
    }
  }
  return result;
}

// The real email senders, loaded only when an email is due (they use the app's
// `@/` imports, which the unit tests do not resolve).
export const lazyAutopayNotify = {
  async autopayOff(input) {
    const { billingNotify } = await import("./billingNotify.js");
    return billingNotify().autopayOff(input);
  },
};

// For the admin landlord list: Map(landlordId -> { methodDescription, authorizedAt, consecutiveFailures }) for those with autopay on.
export async function autopayByLandlord(db, landlordIds) {
  const result = new Map();
  for (let i = 0; i < landlordIds.length; i += 200) {
    const { data, error } = await db
      .from("autopay_authorizations")
      .select("user_id, authorized_at, consecutive_failures, method:payment_methods!payment_method_id(type, brand, last4, exp_month, exp_year, bank_name)")
      .in("user_id", landlordIds.slice(i, i + 200))
      .is("revoked_at", null);
    if (error) {
      // Before the autopay migration reaches an environment: nobody has autopay.
      if (error.code === "PGRST205" || error.code === "42P01") return result;
      throw error;
    }
    for (const a of data ?? []) {
      result.set(a.user_id, {
        methodDescription: a.method ? describeMethod(a.method) : null,
        authorizedAt: a.authorized_at,
        consecutiveFailures: a.consecutive_failures ?? 0,
      });
    }
  }
  return result;
}
