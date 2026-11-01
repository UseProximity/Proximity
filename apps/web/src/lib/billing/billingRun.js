/*
 * The monthly billing run. For each landlord it collects every Approved charge
 * that is not yet on an invoice into one Stripe invoice (a line per charge) and
 * charges the landlord's default payment method once.
 *
 * Safe to run again at any point, including after a crash halfway through:
 *
 *   - A local billing_invoices row per (landlord, month) is the lock. It is
 *     written first, and its unique key means a second run, or a concurrent one,
 *     cannot start a second invoice for the same landlord and month.
 *   - Charges are claimed (Approved -> Invoiced, pointing at that row) before
 *     anything is created in Stripe, so a charge is never on two invoices and one
 *     that changed meanwhile (voided, contested) is simply left out.
 *   - The Stripe steps (draft, items, finalize, pay) each check what already
 *     exists first, so repeating them adds nothing. See invoicing.js.
 *   - A landlord whose total is under the minimum is not invoiced; their charges
 *     stay Approved and roll into the next month.
 *   - A month's invoice is never added to after it is finalized: a charge approved
 *     later waits for the next run.
 *
 * Dry run computes every invoice and total and creates nothing, in Stripe or the
 * database. One landlord failing never stops the others.
 *
 * `db` is a service-role Supabase client and `stripe` a Stripe client. `notify`
 * ({ paymentFailed }) sends the emails; `hooks.at(name, ctx)` is a test seam that
 * is called between steps so tests can simulate a crash there.
 */
import { MIN_INVOICE_CENTS } from "./constants.js";
import { billingPeriodFor } from "./billingPeriod.js";
import { invoiceIdempotencyKey, lineDescription, planInvoices } from "./invoicePlan.js";
import { leaseLabel } from "./chargeDisplay.js";
import { transitionCharge } from "./charges.js";
import { getOrCreateBillingAccount } from "./customers.js";
import { defaultActiveMethod as defaultMethod } from "./paymentMethods.js";
import {
  assertDraftTotal,
  ensureDraftInvoice,
  ensureInvoiceItems,
  finalizeInvoice,
  findInvoiceByKey,
  payInvoice,
  paymentFailureMessage,
  recordPaymentFailure,
} from "./invoicing.js";

const PAGE = 1000;

const CHARGE_COLUMNS = `
  id, landlord_id, amount_cents, trigger_type, status, invoice_id, created_at,
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

async function openInvoicesForPeriod(db, billingPeriod, landlordId) {
  let q = db
    .from("billing_invoices")
    .select("id, landlord_id, billing_period, stripe_invoice_id, status, total_cents")
    .eq("billing_period", billingPeriod)
    .eq("status", "open");
  if (landlordId) q = q.eq("landlord_id", landlordId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
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
async function continueInvoice({ db, stripe, now, notify, hooks }, row) {
  const claimedRows = await chargesOnInvoice(db, row.id);
  const lines = claimedRows.map((r) => ({
    chargeId: r.id,
    amountCents: r.amount_cents,
    description: lineDescription(r),
  }));
  const total = lines.reduce((s, l) => s + l.amountCents, 0);

  const landlord = (await usersById(db, [row.landlord_id])).get(row.landlord_id);
  const account = await getOrCreateBillingAccount(db, stripe, {
    id: row.landlord_id,
    email: landlord?.email,
    name: landlord?.name,
  });
  const key = invoiceIdempotencyKey(row.landlord_id, row.billing_period);

  let invoice = await findInvoiceByKey(stripe, account.stripe_customer_id, key);
  if (!invoice) {
    invoice = await ensureDraftInvoice(stripe, {
      customerId: account.stripe_customer_id,
      key,
      landlordId: row.landlord_id,
      billingPeriod: row.billing_period,
      localInvoiceId: row.id,
    });
  }
  await hooks.at?.("stripe_invoice_created", { row, invoice });

  // "unchanged" unless this call actually moves the invoice forward, so a run that
  // only re-checks finished invoices does not report them as new.
  let outcome = "unchanged";

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
    const { error } = await db
      .from("billing_invoices")
      .update({
        total_cents: total,
        invoice_date: now.toISOString(),
        hosted_invoice_url: invoice.hosted_invoice_url ?? null,
        invoice_pdf_url: invoice.invoice_pdf ?? null,
      })
      .eq("id", row.id);
    if (error) throw error;
    outcome = "invoiced";
    await hooks.at?.("finalized", { row, invoice });
  }

  // Pay once. An invoice that already had an attempt is not attempted again here;
  // a failed one is the landlord's (or an admin's) to retry.
  if (invoice.status === "open" && !invoice.attempted) {
    const method = await defaultMethod(db, row.landlord_id, now);
    if (!method) {
      await recordPaymentFailure(db, { invoiceId: row.id, message: "No active payment method on file", notify, now });
      outcome = "payment_failed";
    } else {
      try {
        await payInvoice(stripe, invoice.id, method.stripe_payment_method_id);
        outcome = "payment_started";
      } catch (err) {
        await recordPaymentFailure(db, { invoiceId: row.id, message: paymentFailureMessage(err), notify, now });
        outcome = "payment_failed";
      }
    }
    await hooks.at?.("paid", { row, invoice });
  }
  return { outcome, stripeInvoiceId: invoice.id, totalCents: total, chargeCount: lines.length };
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

  const { data: row, error } = await db
    .from("billing_invoices")
    .insert({
      landlord_id: planned.landlordId,
      billing_period: planned.billingPeriod,
      total_cents: planned.totalCents,
      status: "open",
      invoice_date: now.toISOString(),
    })
    .select("id, landlord_id, billing_period, stripe_invoice_id, status, total_cents")
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
  return continueInvoice(ctx, { ...row, total_cents: claimedTotal });
}

/*
 * Pick up a local row a crashed run left behind. If nothing has reached Stripe
 * (or the invoice is still a draft) it may also claim charges that were approved
 * since; once the invoice is finalized it is only finished, never added to.
 */
async function resumeInvoice(ctx, row) {
  const { db, stripe } = ctx;
  const landlord = (await usersById(db, [row.landlord_id])).get(row.landlord_id);
  const account = await getOrCreateBillingAccount(db, stripe, { id: row.landlord_id, email: landlord?.email, name: landlord?.name });
  const key = invoiceIdempotencyKey(row.landlord_id, row.billing_period);
  const existing = await findInvoiceByKey(stripe, account.stripe_customer_id, key);

  if (!existing || existing.status === "draft") {
    const fresh = planInvoices(await approvedUninvoiced(db, row.landlord_id).then((r) => r.map(toPlanningRow)), {
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
  return continueInvoice(ctx, row);
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
  const openRows = await openInvoicesForPeriod(db, billingPeriod, onlyLandlordId);
  const billedLandlords = new Set(openRows.map((r) => r.landlord_id));

  if (dryRun) {
    const users = await usersById(db, [...new Set([...plan.invoices.map((i) => i.landlordId), ...plan.deferred.map((d) => d.landlordId)])]);
    const methodReady = new Map();
    for (const inv of plan.invoices) methodReady.set(inv.landlordId, !!(await defaultMethod(db, inv.landlordId, now)));
    const show = (id) => ({ id, name: users.get(id)?.name ?? null, email: users.get(id)?.email ?? null });
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
        waitsForNextMonth: billedLandlords.has(inv.landlordId),
      })),
      deferred: plan.deferred.map((d) => ({ ...d, landlord: show(d.landlordId) })),
      // This month's invoices still open (unpaid, or not finished by an earlier run); a live run re-checks them.
      openInvoices: openRows.length,
      grandTotalCents: plan.grandTotalCents,
    };
  }

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
  for (const row of openRows) await attempt(row.landlord_id, () => resumeInvoice(ctx, row));
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
      invoiced: count("payment_started") + count("invoiced"),
      paymentFailed: count("payment_failed"),
      deferred: count("deferred"),
      alreadyBilled: count("already_billed"),
      errors: count("error"),
    },
  };
}
