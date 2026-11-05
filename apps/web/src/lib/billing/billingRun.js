/*
 * The monthly billing run. For each landlord it collects every Approved charge
 * that is not yet on an invoice into one Stripe invoice (a line per charge),
 * sends it (send_invoice, due in 30 days) and emails the landlord a summary with
 * Pay now. It never charges anyone: the landlord pays, or autopay they switched
 * on charges it AUTOPAY_BUSINESS_DAYS business days later (autopay.js), which
 * this run only schedules.
 *
 * Safe to run again at any point, including after a crash halfway through:
 *
 *   - A local billing_invoices row per (landlord, month) is the lock. It is
 *     written first, and its unique key means a second run, or a concurrent one,
 *     cannot start a second invoice for the same landlord and month.
 *   - Charges are claimed (Approved -> Invoiced, pointing at that row) before
 *     anything is created in Stripe, so a charge is never on two invoices and one
 *     that changed meanwhile (voided, contested) is simply left out.
 *   - The Stripe steps (draft, items, finalize) each check what already
 *     exists first, so repeating them adds nothing. See invoicing.js.
 *   - A landlord whose total is under the minimum is not invoiced; their charges
 *     stay Approved and roll into the next month.
 *   - A month's invoice is never added to after it is finalized: a charge approved
 *     later waits for the next run.
 *
 *   - A row an earlier run left unfinished (never finalized in Stripe) is finished
 *     by the next run, whatever month it belongs to. A row from an earlier month
 *     is only finished with the charges already on it, never added to.
 *   - Only one live run at a time: the cron and an admin's Run billing now cannot
 *     overlap (see withRunLock).
 *
 * Dry run computes every invoice and total and creates nothing, in Stripe or the
 * database. One landlord failing never stops the others.
 *
 * `db` is a service-role Supabase client and `stripe` a Stripe client. `notify`
 * ({ invoiceIssued, autopayOff }) sends the emails; `hooks.at(name, ctx)` is a test seam that
 * is called between steps so tests can simulate a crash there.
 */
import { BillingError } from "./errors.js";
import { MIN_INVOICE_CENTS } from "./constants.js";
import { billingPeriodFor } from "./billingPeriod.js";
import { withSettingsLock } from "./settings.js";
import { hasActivePaymentMethod } from "./paymentMethodState.js";
import { scheduleAutopay } from "./autopay.js";
import { invoiceIdempotencyKey, lineDescription, planInvoices } from "./invoicePlan.js";
import { leaseLabel } from "./chargeDisplay.js";
import { transitionCharge } from "./charges.js";
import { getOrCreateBillingAccount } from "./customers.js";
import { defaultActiveMethod as defaultMethod } from "./paymentMethods.js";
import {
  assertDraftTotal,
  assertInvoiceMatches,
  createDraftInvoice,
  ensureInvoiceItems,
  finalizeInvoice,
  finalizedFields,
  findInvoiceByKey,
} from "./invoicing.js";

const PAGE = 1000;

const CHARGE_COLUMNS = `
  id, landlord_id, amount_cents, trigger_type, status, invoice_id, created_at,
  signed_rent_cents, commission_rate_percent,
  listing:listings!listing_id(title, address),
  lease:unit_leases!lease_id(lease_term_months, listing_units!unit_id(name, unit_designator, unit_number, bedrooms)),
  student:users!student_id(name)
`;

// The invoice-line fields planInvoices and lineDescription read.
const toPlanningRow = (c) => ({
  id: c.id,
  landlord_id: c.landlord_id,
  amount_cents: c.amount_cents,
  trigger_type: c.trigger_type,
  status: c.status,
  invoice_id: c.invoice_id,
  created_at: c.created_at,
  listing_label: c.listing?.address ?? c.listing?.title ?? null,
  lease_label: leaseLabel(c.lease),
  student_name: c.student?.name ?? null,
  signed_rent_cents: c.signed_rent_cents ?? null,
  commission_rate_percent: c.commission_rate_percent ?? null,
});

async function pageAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

function approvedUninvoiced(db, landlordId) {
  return pageAll(() => {
    let q = db
      .from("charges")
      .select(CHARGE_COLUMNS)
      .eq("status", "approved")
      .is("invoice_id", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (landlordId) q = q.eq("landlord_id", landlordId);
    return q;
  });
}

async function chargesOnInvoice(db, localInvoiceId) {
  const { data, error } = await db
    .from("charges")
    .select(CHARGE_COLUMNS)
    .eq("invoice_id", localInvoiceId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return data.map(toPlanningRow);
}

const ROW_COLUMNS = "id, landlord_id, billing_period, stripe_invoice_id, status, total_cents, invoice_date, hosted_invoice_url";

/*
 * Open rows a live run re-checks: this month's, plus any from an earlier month
 * that a run never finished (no invoice date: Stripe never finalized it). Without
 * the second part a row left half done in one month would never be picked up
 * again, and the charges claimed onto it would never be billed.
 */
async function openInvoicesToResume(db, billingPeriod, landlordId) {
  let q = db
    .from("billing_invoices")
    .select(ROW_COLUMNS)
    .eq("status", "open")
    .or(`billing_period.eq.${billingPeriod},invoice_date.is.null`)
    .order("billing_period", { ascending: true });
  if (landlordId) q = q.eq("landlord_id", landlordId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// Landlords with any invoice row for this month, whatever its status.
async function landlordsInvoicedFor(db, billingPeriod, landlordId) {
  let q = db.from("billing_invoices").select("landlord_id").eq("billing_period", billingPeriod);
  if (landlordId) q = q.eq("landlord_id", landlordId);
  const { data, error } = await q;
  if (error) throw error;
  return new Set(data.map((r) => r.landlord_id));
}

// Whether the landlord has a usable method on file (shown in the dry run; nothing is charged by the run).
async function hasUsableMethod(db, landlordId, now) {
  if (await defaultMethod(db, landlordId, now)) return true;
  const { data, error } = await db
    .from("payment_methods")
    .select("status, type, exp_month, exp_year, deleted_at")
    .eq("user_id", landlordId)
    .is("deleted_at", null);
  if (error) throw error;
  return hasActivePaymentMethod(data, now);
}

async function usersById(db, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await db.from("users").select("id, name, email").in("id", ids);
  if (error) throw error;
  return new Map(data.map((u) => [u.id, u]));
}

// Claim the planned charges for this invoice: Approved -> Invoiced. A charge that
// changed since it was read (voided, contested, already claimed) is left out.
async function claimCharges(db, localInvoiceId, lines) {
  const claimed = [];
  for (const line of lines) {
    try {
      await transitionCharge(db, {
        chargeId: line.chargeId,
        expectedFrom: "approved",
        to: "invoiced",
        actorType: "system",
        invoiceId: localInvoiceId,
      });
      claimed.push(line);
    } catch (err) {
      if (err?.code !== "status_changed" && err?.code !== "not_allowed") throw err;
    }
  }
  return claimed;
}

// Give claimed charges back (below the minimum after some dropped out) and drop the row.
async function releaseInvoice(db, localInvoiceId) {
  const { data: charges, error } = await db.from("charges").select("id").eq("invoice_id", localInvoiceId);
  if (error) throw error;
  for (const { id } of charges) {
    await transitionCharge(db, { chargeId: id, expectedFrom: "invoiced", to: "approved", actorType: "system" });
  }
  const { error: deleteError } = await db.from("billing_invoices").delete().eq("id", localInvoiceId);
  if (deleteError) throw deleteError;
}

/*
 * Carry one local invoice row through every Stripe step it has not done yet. The
 * charges on it are already claimed. Returns what happened, for the run report.
 */
async function continueInvoice({ db, stripe, now, notify, hooks }, row, known) {
  const claimedRows = await chargesOnInvoice(db, row.id);
  const lines = claimedRows.map((r) => ({
    chargeId: r.id,
    amountCents: r.amount_cents,
    description: lineDescription(r),
  }));
  // What the invoice email lists: each line with its signed rent and rate, when known.
  const emailLines = claimedRows.map((r, i) => ({
    description: lines[i].description,
    amountCents: r.amount_cents,
    signedRentCents: r.signed_rent_cents,
    commissionRatePercent: r.commission_rate_percent,
  }));
  const total = lines.reduce((s, l) => s + l.amountCents, 0);

  const landlord = (await usersById(db, [row.landlord_id])).get(row.landlord_id);
  const account = await getOrCreateBillingAccount(db, stripe, {
    id: row.landlord_id,
    email: landlord?.email,
    name: landlord?.name,
  });
  const key = invoiceIdempotencyKey(row.landlord_id, row.billing_period);

  // `known` is the caller's lookup by key (null when it found nothing); look it up
  // here only when the caller did not.
  let invoice = known !== undefined ? known : await findInvoiceByKey(stripe, account.stripe_customer_id, key);
  if (!invoice) {
    invoice = await createDraftInvoice(stripe, {
      customerId: account.stripe_customer_id,
      key,
      landlordId: row.landlord_id,
      billingPeriod: row.billing_period,
      localInvoiceId: row.id,
    });
  }
  // Anything already finalized must be the invoice we built for these charges.
  if (invoice.status !== "draft") await assertInvoiceMatches(stripe, invoice, lines, total);
  await hooks.at?.("stripe_invoice_created", { row, invoice });

  // "unchanged" unless this call actually moves the invoice forward, so a run that
  // only re-checks finished invoices does not report them as new.
  let outcome = "unchanged";
  let sentNow = false;

  const { error: linkError } = await db.from("billing_invoices").update({ stripe_invoice_id: invoice.id }).eq("id", row.id);
  if (linkError) throw linkError;

  if (invoice.status === "draft") {
    const items = await ensureInvoiceItems(stripe, { invoice, customerId: account.stripe_customer_id, lines });
    for (const [chargeId, itemId] of items) {
      const { error } = await db.from("charges").update({ stripe_invoice_item_id: itemId }).eq("id", chargeId).eq("invoice_id", row.id);
      if (error) throw error;
    }
    await hooks.at?.("items_created", { row, invoice });

    await assertDraftTotal(stripe, invoice.id, total);
    invoice = await finalizeInvoice(stripe, invoice.id);
    await hooks.at?.("stripe_finalized", { row, invoice });
    const { error } = await db
      .from("billing_invoices")
      .update({ total_cents: total, ...finalizedFields(invoice, now) })
      .eq("id", row.id);
    if (error) throw error;
    outcome = "invoiced";
    sentNow = true;
    await hooks.at?.("finalized", { row, invoice });
  } else if (!row.invoice_date || !row.hosted_invoice_url) {
    // An earlier run finalized it in Stripe and stopped before saving the date and
    // links. Save them now, from Stripe, so the overdue clock and the landlord's
    // invoice page are right.
    const { error } = await db
      .from("billing_invoices")
      .update({ total_cents: total, ...finalizedFields(invoice, now) })
      .eq("id", row.id);
    if (error) throw error;
    sentNow = true;
  }

  // Sent just now (or finished by this resumed run): schedule autopay and email it.
  if (sentNow) await announceInvoice({ db, now, notify }, { row, invoice, landlord, emailLines, total });
  return { outcome, stripeInvoiceId: invoice.id, totalCents: total, chargeCount: lines.length };
}

/*
 * The invoice was just sent: schedule autopay if the landlord has it on, then
 * email them the summary with Pay now (and the autopay date). Neither may fail
 * the run: the invoice exists either way, and an admin can resend the email.
 */
async function announceInvoice({ db, now, notify }, { row, invoice, landlord, emailLines, total }) {
  const sentAt = finalizedFields(invoice, now).sent_at;
  let autopay = null;
  try {
    autopay = await scheduleAutopay(db, { invoiceId: row.id, landlordId: row.landlord_id, sentAt, notify, now });
  } catch (err) {
    console.error("billing: could not schedule autopay", row.id, err?.message);
  }
  if (!notify?.invoiceIssued || !landlord?.email) return;
  try {
    await notify.invoiceIssued({
      landlord,
      invoice: {
        id: row.id,
        billing_period: row.billing_period,
        total_cents: total,
        due_date: finalizedFields(invoice, now).due_date,
        hosted_invoice_url: invoice.hosted_invoice_url ?? null,
      },
      lines: emailLines,
      autopay,
    });
  } catch (err) {
    console.error("billing: invoice email failed", row.id, err?.message);
  }
}

async function billLandlord(ctx, planned) {
  const { db, now } = ctx;
  const { data: existing, error: existingError } = await db
    .from("billing_invoices")
    .select("id")
    .eq("landlord_id", planned.landlordId)
    .eq("billing_period", planned.billingPeriod)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { outcome: "already_billed" };

  // No local record, so no finalized Stripe invoice for this landlord and month should exist
  // either. If one does (a record was lost, or it came from somewhere else), claiming charges
  // onto it would mark them billed when they never were. Stop before touching anything.
  const landlord = (await usersById(db, [planned.landlordId])).get(planned.landlordId);
  const account = await getOrCreateBillingAccount(db, ctx.stripe, {
    id: planned.landlordId,
    email: landlord?.email,
    name: landlord?.name,
  });
  const stripeInvoice = await findInvoiceByKey(
    ctx.stripe,
    account.stripe_customer_id,
    invoiceIdempotencyKey(planned.landlordId, planned.billingPeriod)
  );
  if (stripeInvoice && stripeInvoice.status !== "draft") {
    throw new BillingError(
      "invoice_exists",
      `Stripe already has a finalized invoice (${stripeInvoice.id}) for this landlord and month but there is no record of it here.`,
      500
    );
  }

  const { data: row, error } = await db
    .from("billing_invoices")
    .insert({
      landlord_id: planned.landlordId,
      billing_period: planned.billingPeriod,
      total_cents: planned.totalCents,
      status: "open",
      // invoice_date stays empty until Stripe finalizes the invoice (finalizedFields).
    })
    .select(ROW_COLUMNS)
    .single();
  if (error) {
    // Another run got there between the check and the insert.
    if (error.code === "23505") return { outcome: "already_billed" };
    throw error;
  }
  await ctx.hooks.at?.("row_inserted", { row });

  const claimed = await claimCharges(db, row.id, planned.lines);
  const claimedTotal = claimed.reduce((s, l) => s + l.amountCents, 0);
  await ctx.hooks.at?.("charges_claimed", { row });

  if (claimed.length === 0) {
    await db.from("billing_invoices").delete().eq("id", row.id);
    return { outcome: "nothing_to_bill" };
  }
  if (claimedTotal < MIN_INVOICE_CENTS) {
    await releaseInvoice(db, row.id);
    return { outcome: "deferred", totalCents: claimedTotal };
  }
  if (claimedTotal !== row.total_cents) {
    const { error: updateError } = await db.from("billing_invoices").update({ total_cents: claimedTotal }).eq("id", row.id);
    if (updateError) throw updateError;
  }
  return continueInvoice(ctx, { ...row, total_cents: claimedTotal }, stripeInvoice);
}

/*
 * Pick up a local row a crashed run left behind. If nothing has reached Stripe
 * (or the invoice is still a draft) and the row is this month's, it may also
 * claim charges that were approved since; a row from an earlier month, or one
 * already finalized, is only finished, never added to.
 */
async function resumeInvoice(ctx, row, billingPeriod) {
  const { db, stripe } = ctx;
  const landlord = (await usersById(db, [row.landlord_id])).get(row.landlord_id);
  const account = await getOrCreateBillingAccount(db, stripe, { id: row.landlord_id, email: landlord?.email, name: landlord?.name });
  const key = invoiceIdempotencyKey(row.landlord_id, row.billing_period);
  const existing = await findInvoiceByKey(stripe, account.stripe_customer_id, key);

  if (!existing || existing.status === "draft") {
    const fresh = row.billing_period !== billingPeriod ? null : planInvoices(await approvedUninvoiced(db, row.landlord_id).then((r) => r.map(toPlanningRow)), {
      billingPeriod: row.billing_period,
      minCents: 1,
    }).invoices[0];
    if (fresh) await claimCharges(db, row.id, fresh.lines);
    const claimedTotal = (await chargesOnInvoice(db, row.id)).reduce((s, r) => s + r.amount_cents, 0);
    if (claimedTotal === 0) {
      await db.from("billing_invoices").delete().eq("id", row.id);
      return { outcome: "nothing_to_bill" };
    }
    if (claimedTotal < MIN_INVOICE_CENTS) {
      await releaseInvoice(db, row.id);
      return { outcome: "deferred", totalCents: claimedTotal };
    }
    row = { ...row, total_cents: claimedTotal };
  }
  return continueInvoice(ctx, row, existing);
}

export async function runBillingRun({
  db,
  stripe,
  now = new Date(),
  dryRun = true,
  onlyLandlordId = null,
  notify = {},
  hooks = {},
}) {
  const billingPeriod = billingPeriodFor(now);
  const charges = await approvedUninvoiced(db, onlyLandlordId);
  const plan = planInvoices(charges.map(toPlanningRow), { billingPeriod });
  const openRows = await openInvoicesToResume(db, billingPeriod, onlyLandlordId);
  // Only this month's row stands in for this month's invoice. A stranded row from
  // an earlier month is finished separately and does not stop this month's.
  const billedLandlords = new Set(openRows.filter((r) => r.billing_period === billingPeriod).map((r) => r.landlord_id));

  if (dryRun) {
    const users = await usersById(db, [...new Set([...plan.invoices.map((i) => i.landlordId), ...plan.deferred.map((d) => d.landlordId)])]);
    const methodReady = new Map();
    for (const inv of plan.invoices) methodReady.set(inv.landlordId, await hasUsableMethod(db, inv.landlordId, now));
    const show = (id) => ({ id, name: users.get(id)?.name ?? null, email: users.get(id)?.email ?? null });
    // A live run bills nobody who already has this month's invoice in any status
    // (billLandlord answers already_billed), so the preview must not count them.
    const invoicedThisMonth = await landlordsInvoicedFor(db, billingPeriod, onlyLandlordId);
    const willBill = plan.invoices.filter((inv) => !invoicedThisMonth.has(inv.landlordId));
    return {
      dryRun: true,
      billingPeriod,
      invoices: plan.invoices.map((inv) => ({
        landlord: show(inv.landlordId),
        totalCents: inv.totalCents,
        chargeCount: inv.lines.length,
        lines: inv.lines,
        hasActivePaymentMethod: methodReady.get(inv.landlordId),
        // Already has this month's invoice: these charges wait for next month.
        waitsForNextMonth: invoicedThisMonth.has(inv.landlordId),
      })),
      deferred: plan.deferred.map((d) => ({ ...d, landlord: show(d.landlordId) })),
      // Invoices still open (this month's, or any month's that an earlier run never finished); a live run re-checks them.
      openInvoices: openRows.length,
      unfinishedInvoices: openRows.filter((r) => !r.invoice_date).length,
      // What a live run would invoice now: landlords already invoiced this month are left out.
      newInvoiceCount: willBill.length,
      grandTotalCents: willBill.reduce((sum, inv) => sum + inv.totalCents, 0),
    };
  }

  return withRunLock(db, now, () => liveRun({ db, stripe, now, notify, hooks, billingPeriod, plan, openRows, billedLandlords }));
}

async function liveRun({ db, stripe, now, notify, hooks, billingPeriod, plan, openRows, billedLandlords }) {
  const ctx = { db, stripe, now, notify, hooks };
  const results = [];
  const attempt = async (landlordId, fn) => {
    try {
      results.push({ landlordId, ...(await fn()) });
    } catch (err) {
      results.push({ landlordId, outcome: "error", error: String(err?.message ?? err).slice(0, 300) });
    }
  };

  // Finish what an earlier run left half done first, then bill the rest.
  for (const row of openRows) await attempt(row.landlord_id, () => resumeInvoice(ctx, row, billingPeriod));
  for (const planned of plan.invoices) {
    if (billedLandlords.has(planned.landlordId)) continue;
    await attempt(planned.landlordId, () => billLandlord(ctx, planned));
  }
  for (const d of plan.deferred) results.push({ landlordId: d.landlordId, outcome: "deferred", totalCents: d.totalCents });

  const count = (o) => results.filter((r) => r.outcome === o).length;
  return {
    dryRun: false,
    billingPeriod,
    results,
    summary: {
      invoiced: count("invoiced"),
      deferred: count("deferred"),
      alreadyBilled: count("already_billed"),
      errors: count("error"),
    },
  };
}

// ── One live run at a time ──────────────────────────────────────────────────

export const RUN_LOCK_KEY = "billing_run_lock";

/*
 * Two live runs at once (the first-Monday cron and an admin's Run billing now)
 * could both work on the same landlord's invoice and email it twice. The stale limit is longer than the cron's 300s, so a
 * lock left by a run that was killed frees itself, but never while a run could
 * still be going.
 */
function withRunLock(db, now, fn) {
  return withSettingsLock(
    db,
    { key: RUN_LOCK_KEY, staleMs: 15 * 60 * 1000, now, busyMessage: "A billing run is already in progress. Try again in a few minutes." },
    fn
  );
}
