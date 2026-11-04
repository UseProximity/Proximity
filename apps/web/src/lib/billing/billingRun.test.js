/*
 * Run with: npm test (from apps/web).
 *
 * The parts of the monthly run that need neither Stripe nor a database. The run
 * itself (dry run, re-runs, the minimum, a charge changing mid-run, a crash at
 * every step) is exercised against the Stripe sandbox and the dev database.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextBillingDay } from "./billingPeriod.js";
import { assertInvoiceMatches, finalizedFields, paymentFailureMessage, paymentUnderway, periodLabel, recordPaymentFailure } from "./invoicing.js";
import { invoiceView, retryInvoicePayment } from "./invoiceAccess.js";
import { adjustPaidCharge } from "./adjustments.js";
import { BILLING_RUN_ENABLED, getBillingSetting, withSettingsLock } from "./settings.js";
import { chargeableMethod } from "./paymentMethods.js";
import { attentionState, runMethodAttentionJob } from "./methodAttentionJob.js";
import { sendEnrollmentEmails } from "./enrollment.js";
import { runBillingRun } from "./billingRun.js";

describe("nextBillingDay", () => {
  it("is today on the billing day itself", () => {
    assert.equal(nextBillingDay(new Date("2026-11-02T18:00:00Z")), "2026-11-02");
  });

  it("is next month's first Monday once this month's has passed", () => {
    assert.equal(nextBillingDay(new Date("2026-11-03T18:00:00Z")), "2026-12-07");
    assert.equal(nextBillingDay(new Date("2026-10-31T18:00:00Z")), "2026-11-02");
  });

  it("is this month's first Monday before it arrives", () => {
    assert.equal(nextBillingDay(new Date("2026-12-01T18:00:00Z")), "2026-12-07");
  });

  it("rolls over the year", () => {
    assert.equal(nextBillingDay(new Date("2026-12-28T18:00:00Z")), "2027-01-04");
  });
});

describe("periodLabel", () => {
  it("names the month on the invoice", () => {
    assert.equal(periodLabel("2026-11-01"), "November 2026");
    assert.equal(periodLabel("2027-01-01"), "January 2027");
  });
});

describe("assertInvoiceMatches", () => {
  // A stand-in Stripe whose invoice items carry the given charge ids.
  const stripeWith = (chargeIds) => ({
    invoiceItems: {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          for (const id of chargeIds) yield { metadata: { charge_id: id } };
        },
      }),
    },
  });
  const lines = [{ chargeId: "c1", amountCents: 3000 }, { chargeId: "c2", amountCents: 2000 }];

  it("accepts an invoice with the right total and a line for every charge", async () => {
    await assert.doesNotReject(() => assertInvoiceMatches(stripeWith(["c1", "c2"]), { id: "in_1", total: 5000 }, lines, 5000));
  });

  it("refuses an invoice with a different total (a stale invoice for the same month)", async () => {
    await assert.rejects(
      () => assertInvoiceMatches(stripeWith(["c1", "c2"]), { id: "in_old", total: 5500 }, lines, 5000),
      (e) => e.code === "invoice_mismatch" && /5500 cents but 5000/.test(e.message)
    );
  });

  it("refuses an invoice that is missing a line, even if the total happens to match", async () => {
    await assert.rejects(
      () => assertInvoiceMatches(stripeWith(["c1", "other"]), { id: "in_x", total: 5000 }, lines, 5000),
      (e) => e.code === "invoice_mismatch" && /no line for 1 of the charges/.test(e.message)
    );
  });
});

describe("paymentFailureMessage", () => {
  it("keeps a plain decline as Stripe words it", () => {
    assert.equal(paymentFailureMessage({ message: "Your card was declined." }), "Your card was declined.");
    assert.equal(
      paymentFailureMessage({ message: "The customer's account has insufficient funds to cover this payment." }),
      "The customer's account has insufficient funds to cover this payment."
    );
  });

  it("replaces Stripe's developer wording for a payment that needs authentication", () => {
    const wanted = "Your bank needs you to confirm this payment. Open the invoice to complete it.";
    assert.equal(
      paymentFailureMessage({ message: "The invoice payment requires additional action. Retrieve the invoice's PaymentIntent, then use `client_secret` and `next_action`..." }),
      wanted
    );
    assert.equal(paymentFailureMessage({ code: "authentication_required", message: "x" }), wanted);
    assert.equal(paymentFailureMessage({ code: "invoice_payment_intent_requires_action", message: "x" }), wanted);
  });

  it("never shows a landlord Stripe ids or developer wording (PR #370 review)", () => {
    const generic = "The payment did not go through.";
    assert.equal(paymentFailureMessage({ message: "No such PaymentMethod: 'pm_1QabcDEFghiJKL'" }), generic);
    assert.equal(paymentFailureMessage({ message: "The PaymentMethod provided (pm_1QabcDEF) was previously used without being attached to a Customer" }), generic);
    assert.equal(paymentFailureMessage({ message: "Invalid parameter: invoice in_1QabcDEFghi" }), generic);
    assert.equal(paymentFailureMessage({ message: "Your card has expired." }), "Your card has expired.");
  });

  it("always says something", () => {
    assert.equal(paymentFailureMessage({}), "The payment did not go through.");
    assert.equal(paymentFailureMessage(null), "The payment did not go through.");
  });
});

describe("invoiceView", () => {
  const row = { id: "i1", billing_period: "2027-01-01", total_cents: 5000, invoice_date: "2027-01-04", hosted_invoice_url: "https://h", invoice_pdf_url: "https://p", last_failure_message: "declined" };

  it("does not offer Pay now on an invoice a run never issued (PR #370 review)", () => {
    assert.equal(invoiceView({ ...row, status: "open", invoice_date: null }).canPay, false);
  });

  it("offers Pay now on open and failed invoices only", () => {
    const can = (status) => invoiceView({ ...row, status }).canPay;
    assert.deepEqual(["open", "failed", "processing", "paid", "void", "uncollectible"].map(can), [true, true, false, false, false, false]);
  });

  it("shows the failure reason only while the invoice is failed", () => {
    assert.equal(invoiceView({ ...row, status: "failed" }).failureMessage, "declined");
    assert.equal(invoiceView({ ...row, status: "paid" }).failureMessage, null);
  });

  it("carries the links to Stripe's pages", () => {
    const v = invoiceView({ ...row, status: "open" });
    assert.equal(v.hostedInvoiceUrl, "https://h");
    assert.equal(v.invoicePdfUrl, "https://p");
  });
});

describe("adjustPaidCharge validation", () => {
  const db = { from() { throw new Error("should not reach the database"); } };
  const base = { chargeId: "c", adminId: "a", kind: "refund", amountCents: 100, reason: "wrong" };

  it("refuses an unknown kind, a bad amount and a missing reason before touching anything", async () => {
    await assert.rejects(() => adjustPaidCharge(db, {}, { ...base, kind: "chargeback" }), /refund or a credit/);
    for (const amountCents of [0, -1, 1.5, "100", null]) {
      await assert.rejects(() => adjustPaidCharge(db, {}, { ...base, amountCents }), /amount in dollars/);
    }
    await assert.rejects(() => adjustPaidCharge(db, {}, { ...base, reason: "  " }), /reason is required/);
    await assert.rejects(() => adjustPaidCharge(db, {}, { ...base, reason: "x".repeat(1001) }), /under 1000/);
  });
});

describe("getBillingSetting", () => {
  const dbWith = (row) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
  });

  it("reads as off until someone switches billing on", async () => {
    assert.equal(await getBillingSetting(dbWith(null), BILLING_RUN_ENABLED, false), false);
    assert.equal(await getBillingSetting(dbWith({ value: true }), BILLING_RUN_ENABLED, false), true);
    assert.equal(await getBillingSetting(dbWith({ value: false }), BILLING_RUN_ENABLED, false), false);
  });
});

describe("recordPaymentFailure", () => {
  // The few calls it makes: update(...).eq().neq().in().select().maybeSingle(), then a users lookup.
  function fakeDb(updatedRow) {
    const calls = { update: null };
    return {
      calls,
      from(table) {
        if (table === "users") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "l1", name: "Pat", email: "pat@x.com" }, error: null }) }) }) };
        }
        return {
          update(patch) {
            calls.update = patch;
            return {
              eq: () => ({
                neq: () => ({
                  in: () => ({ select: () => ({ maybeSingle: async () => ({ data: updatedRow, error: null }) }) }),
                }),
              }),
            };
          },
        };
      },
    };
  }

  const row = { id: "i1", landlord_id: "l1", total_cents: 5000, invoice_date: "2026-11-02", hosted_invoice_url: null };

  it("records the failure and tells the landlord and the team once", async () => {
    const sent = [];
    const db = fakeDb(row);
    const recorded = await recordPaymentFailure(db, {
      invoiceId: "i1",
      message: "Your card was declined",
      notify: { paymentFailed: async (x) => sent.push(x) },
      now: new Date("2026-11-02T18:00:00Z"),
    });
    assert.equal(recorded, true);
    assert.equal(db.calls.update.status, "failed");
    assert.equal(db.calls.update.last_failure_message, "Your card was declined");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].landlord.email, "pat@x.com");
  });

  it("stays silent when the invoice was already marked failed or is no longer unpaid", async () => {
    const sent = [];
    const recorded = await recordPaymentFailure(fakeDb(null), {
      invoiceId: "i1",
      message: "again",
      notify: { paymentFailed: async (x) => sent.push(x) },
    });
    assert.equal(recorded, false);
    assert.equal(sent.length, 0);
  });

  it("keeps a very long Stripe message to a sane length", async () => {
    const db = fakeDb(row);
    await recordPaymentFailure(db, { invoiceId: "i1", message: "x".repeat(2000), notify: null });
    assert.equal(db.calls.update.last_failure_message.length, 500);
  });
});

describe("finalizedFields (PR #370 review)", () => {
  it("dates the invoice when Stripe finalized it, not when the run started", () => {
    const f = finalizedFields({ status_transitions: { finalized_at: 1793664000 }, hosted_invoice_url: "https://h", invoice_pdf: "https://p" }, new Date("2030-01-01"));
    assert.equal(f.invoice_date, new Date(1793664000 * 1000).toISOString());
    assert.equal(f.hosted_invoice_url, "https://h");
    assert.equal(f.invoice_pdf_url, "https://p");
  });

  it("falls back to now when Stripe gives no finalize time", () => {
    assert.equal(finalizedFields({}, new Date("2026-11-02T18:00:00Z")).invoice_date, "2026-11-02T18:00:00.000Z");
  });

  it("records when it was sent and when it is due (send_invoice, 30 days)", () => {
    const f = finalizedFields({ status_transitions: { finalized_at: 1793664000 }, due_date: 1796256000, collection_method: "send_invoice" });
    assert.equal(f.sent_at, new Date(1793664000 * 1000).toISOString());
    assert.equal(f.due_date, new Date(1796256000 * 1000).toISOString());
    assert.equal(f.collection_method, "send_invoice");
    const noDue = finalizedFields({ status_transitions: { finalized_at: 1793664000 } });
    assert.equal(new Date(noDue.due_date) - new Date(noDue.sent_at), 30 * 24 * 60 * 60 * 1000);
  });
});

// A stand-in Stripe: one invoice in `status`, paid by intents in `intentStatuses`.
function fakeStripe({ status = "open", intentStatuses = [], payError = null } = {}) {
  const calls = { pay: 0 };
  return {
    calls,
    invoices: {
      retrieve: async (id) => ({
        id,
        status,
        payments: { data: intentStatuses.map((_, i) => ({ payment: { payment_intent: `pi_${i}` } })) },
      }),
      pay: async () => {
        calls.pay += 1;
        if (payError) throw payError;
        return {};
      },
    },
    paymentIntents: { retrieve: async (id) => ({ id, status: intentStatuses[Number(id.split("_")[1])] }) },
    customers: { update: async () => ({}) },
  };
}

describe("paymentUnderway (PR #370 review)", () => {
  it("says paid, processing, or nothing", async () => {
    assert.equal(await paymentUnderway(fakeStripe({ status: "paid" }), "in_1"), "paid");
    assert.equal(await paymentUnderway(fakeStripe({ intentStatuses: ["processing"] }), "in_1"), "processing");
    assert.equal(await paymentUnderway(fakeStripe({ intentStatuses: ["requires_payment_method"] }), "in_1"), null);
    assert.equal(await paymentUnderway(fakeStripe(), "in_1"), null);
  });
});

// A tiny in-memory stand-in for the Supabase calls these paths make.
function memoryDb(tables) {
  const rows = (t) => (tables[t] ??= []);
  const pick = (r, path) => path.split("->>").reduce((v, k) => (v == null ? v : v[k]), r);
  function query(table) {
    const filters = [];
    let op = { kind: "select" };
    const matches = (r) => filters.every((f) => f(r));
    const api = {
      select() { return api; },
      eq(col, v) { filters.push((r) => pick(r, col) === v); return api; },
      neq(col, v) { filters.push((r) => r[col] !== v); return api; },
      is(col, v) { filters.push((r) => (r[col] ?? null) === v); return api; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return api; },
      not(col, _op, v) { filters.push((r) => (r[col] ?? null) !== v); return api; },
      order() { return api; },
      limit() { return api; },
      range() { return api; },
      or() { return api; },
      insert(row) {
        if (table === "billing_settings" && rows(table).some((r) => r.key === row.key)) {
          return Promise.resolve({ error: { code: "23505" } });
        }
        rows(table).push({ ...row });
        return Promise.resolve({ error: null });
      },
      update(patch) { op = { kind: "update", patch }; return api; },
      delete() { op = { kind: "delete" }; return api; },
      async maybeSingle() { const r = await api.run(); return { data: r.data?.[0] ?? null, error: null }; },
      then(res, rej) { return api.run().then(res, rej); },
      async run() {
        const hit = rows(table).filter(matches);
        if (op.kind === "update") hit.forEach((r) => Object.assign(r, op.patch));
        if (op.kind === "delete") tables[table] = rows(table).filter((r) => !matches(r));
        return { data: hit, error: null };
      },
    };
    return api;
  }
  return { tables, from: query };
}

describe("withSettingsLock (PR #370 review)", () => {
  const opts = (now) => ({ key: "k", staleMs: 60_000, busyMessage: "busy", now });

  it("lets one caller in and refuses a second while it runs", async () => {
    const db = memoryDb({});
    const now = new Date("2026-11-02T18:00:00Z");
    const result = await withSettingsLock(db, opts(now), async () => {
      await assert.rejects(() => withSettingsLock(db, opts(now), async () => "second"), (e) => e.status === 409 && e.message === "busy");
      return "first";
    });
    assert.equal(result, "first");
    assert.equal(db.tables.billing_settings.length, 0, "released afterwards");
  });

  it("takes over a lock left by a caller that died", async () => {
    const db = memoryDb({ billing_settings: [{ key: "k", value: { started_at: "2026-11-02T17:00:00.000Z" } }] });
    const result = await withSettingsLock(db, opts(new Date("2026-11-02T18:00:00Z")), async () => "ran");
    assert.equal(result, "ran");
  });

  it("releases the lock when the work throws", async () => {
    const db = memoryDb({});
    await assert.rejects(() => withSettingsLock(db, opts(new Date()), async () => { throw new Error("boom"); }), /boom/);
    assert.equal(db.tables.billing_settings.length, 0);
  });
});

describe("chargeableMethod (PR #370 review)", () => {
  const now = new Date("2026-11-02T18:00:00Z");
  const card = (over) => ({ id: "m", user_id: "l1", type: "card", status: "active", is_default: false, exp_month: 12, exp_year: 2030, deleted_at: null, stripe_payment_method_id: "pm", created_at: "2026-01-01", ...over });

  it("moves the default off a failed card onto a usable method the landlord added", async () => {
    const db = memoryDb({
      billing_accounts: [{ user_id: "l1", stripe_customer_id: "cus_1" }],
      payment_methods: [card({ id: "old", status: "failed", is_default: true, stripe_payment_method_id: "pm_old" }), card({ id: "bank", type: "us_bank_account", stripe_payment_method_id: "pm_bank" })],
    });
    const m = await chargeableMethod(db, fakeStripe(), "l1", now);
    assert.equal(m.stripe_payment_method_id, "pm_bank");
    assert.deepEqual(db.tables.payment_methods.map((x) => [x.id, x.is_default]), [["old", false], ["bank", true]]);
  });

  it("treats an expired default card the same way", async () => {
    const db = memoryDb({
      billing_accounts: [{ user_id: "l1", stripe_customer_id: "cus_1" }],
      payment_methods: [card({ id: "old", is_default: true, exp_year: 2025, stripe_payment_method_id: "pm_old" }), card({ id: "new", stripe_payment_method_id: "pm_new" })],
    });
    assert.equal((await chargeableMethod(db, fakeStripe(), "l1", now)).stripe_payment_method_id, "pm_new");
  });

  it("keeps a usable default, and finds nothing when nothing is usable", async () => {
    const keep = memoryDb({ payment_methods: [card({ id: "a", is_default: true, stripe_payment_method_id: "pm_a" }), card({ id: "b", stripe_payment_method_id: "pm_b" })] });
    assert.equal((await chargeableMethod(keep, fakeStripe(), "l1", now)).stripe_payment_method_id, "pm_a");
    const none = memoryDb({ billing_accounts: [{ user_id: "l1", stripe_customer_id: "cus_1" }], payment_methods: [card({ status: "failed", is_default: true })] });
    assert.equal(await chargeableMethod(none, fakeStripe(), "l1", now), null);
  });
});

describe("retryInvoicePayment while a payment is settling (PR #370 review)", () => {
  const invoiceRow = { id: "i1", landlord_id: "l1", billing_period: "2026-11-01", stripe_invoice_id: "in_1", status: "open", total_cents: 5000, invoice_date: "2026-11-02" };
  const methods = [{ id: "m", user_id: "l1", type: "card", status: "active", is_default: true, exp_month: 12, exp_year: 2030, deleted_at: null, stripe_payment_method_id: "pm" }];

  it("refuses to pay again, without recording a failure, while an ACH payment is in flight", async () => {
    const db = memoryDb({ billing_invoices: [{ ...invoiceRow }], payment_methods: methods });
    const stripe = fakeStripe({ intentStatuses: ["processing"] });
    await assert.rejects(() => retryInvoicePayment(db, stripe, { invoiceId: "i1", landlordId: "l1" }), (e) => e.code === "in_progress");
    assert.equal(stripe.calls.pay, 0);
    assert.equal(db.tables.billing_invoices[0].status, "open");
  });

  it("does not record a failure when Stripe refuses because another attempt just started", async () => {
    const db = memoryDb({ billing_invoices: [{ ...invoiceRow }], payment_methods: methods });
    const intentStatuses = [];
    const stripe = fakeStripe({ intentStatuses, payError: Object.assign(new Error("Invoice is already being paid"), { code: "invoice_payment_intent_requires_action_x" }) });
    // The racing attempt's intent shows up only after our pay call is refused.
    const pay = stripe.invoices.pay;
    stripe.invoices.pay = async (...a) => { intentStatuses.push("processing"); return pay(...a); };
    assert.deepEqual(await retryInvoicePayment(db, stripe, { invoiceId: "i1", landlordId: "l1" }), { started: true });
    assert.equal(db.tables.billing_invoices[0].status, "open");
  });

  it("refuses an invoice a run never issued", async () => {
    const db = memoryDb({ billing_invoices: [{ ...invoiceRow, invoice_date: null }] });
    await assert.rejects(() => retryInvoicePayment(db, fakeStripe(), { invoiceId: "i1", landlordId: "l1" }), (e) => e.code === "not_payable");
  });

  it("never pays without the landlord: there is no admin payment (decisions of 2026-11-04)", async () => {
    const db = memoryDb({ billing_invoices: [{ ...invoiceRow }], payment_methods: methods });
    const stripe = fakeStripe();
    await assert.rejects(() => retryInvoicePayment(db, stripe, { invoiceId: "i1" }), (e) => e.status === 403);
    await assert.rejects(() => retryInvoicePayment(db, stripe, { invoiceId: "i1", landlordId: "someone-else" }), (e) => e.code === "not_found");
    assert.equal(stripe.calls.pay, 0);
  });
});

describe("attentionState (PR #370 review)", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const card = (over) => ({ type: "card", status: "active", exp_month: 3, exp_year: 2028, ...over });

  it("warns in a card's last valid month, then once it has expired or failed", () => {
    assert.equal(attentionState(card({ exp_month: 11, exp_year: 2026 }), now), "expiring");
    assert.equal(attentionState(card({ exp_month: 10, exp_year: 2026 }), now), "expired");
    assert.equal(attentionState(card({ status: "failed" }), now), "failed");
    assert.equal(attentionState({ type: "us_bank_account", status: "failed" }, now), "failed");
  });

  it("is quiet for a healthy method or one still verifying", () => {
    assert.equal(attentionState(card(), now), null);
    assert.equal(attentionState({ type: "us_bank_account", status: "verifying" }, now), null);
  });
});

describe("runMethodAttentionJob (PR #370 review)", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const method = (over) => ({ id: "m1", user_id: "l1", type: "card", status: "active", is_default: true, brand: "visa", last4: "4242", exp_month: 10, exp_year: 2026, deleted_at: null, attention_emailed_key: null, ...over });
  const landlord = { id: "l1", name: "Pat", email: "pat@x.com", deleted_at: null };

  it("emails once about an expired default card, and not again the next day", async () => {
    const db = memoryDb({ payment_methods: [method()], users: [landlord] });
    const sent = [];
    const notify = { methodAttention: async (x) => sent.push(x) };
    assert.equal((await runMethodAttentionJob(db, { now, notify })).emailed, 1);
    assert.equal(sent[0].state, "expired");
    assert.match(sent[0].description, /Visa ending 4242/);
    assert.equal((await runMethodAttentionJob(db, { now, notify })).emailed, 0);
    assert.equal(sent.length, 1);
  });

  it("stays quiet while the landlord has another usable method", async () => {
    const db = memoryDb({ payment_methods: [method(), method({ id: "m2", is_default: false, exp_year: 2030 })], users: [landlord] });
    const sent = [];
    await runMethodAttentionJob(db, { now, notify: { methodAttention: async (x) => sent.push(x) } });
    assert.equal(sent.length, 0);
  });

  it("clears the note once the method is fine again, so a later problem is emailed", async () => {
    const db = memoryDb({ payment_methods: [method({ exp_year: 2030, attention_emailed_key: "expired:10/2026" })], users: [landlord] });
    assert.equal((await runMethodAttentionJob(db, { now })).cleared, 1);
    assert.equal(db.tables.payment_methods[0].attention_emailed_key, null);
  });
});

describe("sendEnrollmentEmails (PR #370 review)", () => {
  const toSend = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("stops after the first email when sends are not being logged", async () => {
    let sends = 0;
    await assert.rejects(
      () => sendEnrollmentEmails({ toSend, send: async () => (sends += 1, true), isLogged: async () => false }),
      (e) => e.code === "not_logged"
    );
    assert.equal(sends, 1);
  });

  it("sends to everyone when they are", async () => {
    const r = await sendEnrollmentEmails({ toSend, send: async () => true, isLogged: async () => true });
    assert.equal(r.sent, 3);
  });
});

describe("dry run matches the live run (PR #370 review)", () => {
  const now = new Date("2026-11-02T18:00:00Z"); // November's billing day
  const charge = (id, landlord_id, amount_cents) => ({ id, landlord_id, amount_cents, trigger_type: "lease_signed", status: "approved", invoice_id: null, created_at: "2026-10-20" });

  it("leaves landlords already invoiced this month, in any status, out of the total", async () => {
    const db = memoryDb({
      charges: [charge("c1", "paid-already", 3000), charge("c2", "fresh", 4000)],
      billing_invoices: [{ id: "i1", landlord_id: "paid-already", billing_period: "2026-11-01", status: "paid", invoice_date: "2026-11-02" }],
      users: [{ id: "paid-already", name: "A" }, { id: "fresh", name: "B" }],
      payment_methods: [],
    });
    const r = await runBillingRun({ db, stripe: {}, now, dryRun: true });
    assert.equal(r.newInvoiceCount, 1);
    assert.equal(r.grandTotalCents, 4000);
    assert.equal(r.invoices.find((i) => i.landlord.id === "paid-already").waitsForNextMonth, true);
    assert.equal(r.invoices.find((i) => i.landlord.id === "fresh").waitsForNextMonth, false);
  });
});
