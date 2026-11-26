/*
 * Run with: npm test (from apps/web).
 *
 * Autopay, the business-day calendar it charges on, the overdue clock counted
 * from the due date, and the invoice email (decisions of 2026-11-04).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addBusinessDays, chicagoDayStart, fedHolidays, isBusinessDay } from "./businessDays.js";
import {
  autopayDateFor,
  autopayState,
  consentText,
  disableAutopay,
  enableAutopay,
  noteAutopayFailure,
  revokeAutopayForMethod,
  runAutopayJob,
  scheduleAutopay,
} from "./autopay.js";
import { invoiceAttentionReason, isInvoiceOverdue } from "./overdue.js";
import { autopayOffEmail, invoiceIssuedEmail } from "./billingEmailTemplates.js";
import { basisLabel } from "./chargeDisplay.js";
import { invoiceView } from "./invoiceAccess.js";

// ── An in-memory stand-in for the Supabase calls these paths make ───────────

let seq = 0;
function memoryDb(tables) {
  const rows = (t) => (tables[t] ??= []);
  function query(table) {
    const filters = [];
    let op = { kind: "select" };
    let selected = false;
    const matches = (r) => filters.every((f) => f(r));
    const api = {
      select() { selected = true; return api; },
      eq(col, v) { filters.push((r) => r[col] === v); return api; },
      neq(col, v) { filters.push((r) => r[col] !== v); return api; },
      is(col, v) { filters.push((r) => (r[col] ?? null) === v); return api; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return api; },
      not(col, _op, v) { filters.push((r) => (r[col] ?? null) !== v); return api; },
      lte(col, v) { filters.push((r) => r[col] != null && r[col] <= v); return api; },
      gt(col, v) { filters.push((r) => r[col] != null && r[col] > v); return api; },
      lt(col, v) { filters.push((r) => r[col] != null && r[col] < v); return api; },
      order() { return api; },
      limit() { return api; },
      insert(row) {
        op = { kind: "insert", row };
        return api;
      },
      update(patch) { op = { kind: "update", patch }; return api; },
      async maybeSingle() { const r = await api.run(); return { data: r.data?.[0] ?? null, error: r.error ?? null }; },
      async single() { const r = await api.run(); return { data: r.data?.[0] ?? null, error: r.error ?? null }; },
      then(res, rej) { return api.run().then(res, rej); },
      async run() {
        if (op.kind === "insert") {
          if (table === "autopay_authorizations" && rows(table).some((r) => r.user_id === op.row.user_id && !r.revoked_at)) {
            return { data: null, error: { code: "23505" } };
          }
          const row = { id: `id${++seq}`, consecutive_failures: 0, revoked_at: null, ...op.row };
          rows(table).push(row);
          return { data: [row], error: null };
        }
        const hit = rows(table).filter(matches);
        if (op.kind === "update") hit.forEach((r) => Object.assign(r, op.patch));
        return { data: selected || op.kind === "select" ? hit.map((r) => ({ ...r })) : null, error: null };
      },
    };
    return api;
  }
  return { tables, from: query };
}

const now = new Date("2026-11-10T15:00:00Z");
const card = (over) => ({ id: "m1", user_id: "l1", stripe_payment_method_id: "pm_1", type: "card", status: "active", brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030, bank_name: null, deleted_at: null, created_at: "2026-01-01", ...over });
const landlord = { id: "l1", name: "Pat", email: "pat@x.com", deleted_at: null };

// ── Business days ───────────────────────────────────────────────────────────

describe("business days (Chicago, Fed holidays)", () => {
  it("knows the Fed's 2026 holidays, moving a Sunday holiday to Monday and not a Saturday one", () => {
    const h = fedHolidays(2026);
    for (const d of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"]) {
      assert.ok(h.has(d), d);
    }
    assert.equal(h.has("2026-07-03"), false, "July 4 2026 is a Saturday: the Fed does not move it");
    assert.ok(fedHolidays(2027).has("2027-07-05"), "July 4 2027 is a Sunday: observed Monday");
  });

  it("skips weekends and holidays", () => {
    assert.equal(isBusinessDay("2026-11-14"), false); // Saturday
    assert.equal(isBusinessDay("2026-11-26"), false); // Thanksgiving
    assert.equal(isBusinessDay("2026-11-27"), true);
  });

  it("counts 5 business days after the send day, in Chicago", () => {
    assert.equal(addBusinessDays(new Date("2026-11-02T20:00:00Z"), 5), "2026-11-09");
    assert.equal(addBusinessDays(new Date("2026-11-20T20:00:00Z"), 5), "2026-11-30", "Thanksgiving skipped");
    assert.equal(addBusinessDays(new Date("2026-12-24T20:00:00Z"), 5), "2027-01-04", "Christmas and New Year skipped");
    // 03:00 UTC on Nov 3 is still Nov 2 in Chicago.
    assert.equal(addBusinessDays(new Date("2026-11-03T03:00:00Z"), 5), "2026-11-09");
  });

  it("schedules at the start of the Chicago day, in summer and winter time", () => {
    assert.equal(chicagoDayStart("2026-11-09").toISOString(), "2026-11-09T06:00:00.000Z");
    assert.equal(chicagoDayStart("2026-07-06").toISOString(), "2026-07-06T05:00:00.000Z");
    assert.equal(autopayDateFor("2026-11-02T20:00:00Z").toISOString(), "2026-11-09T06:00:00.000Z");
  });
});

// ── Turning autopay on and off ──────────────────────────────────────────────

describe("enableAutopay", () => {
  it("needs the ticked authorisation, and stores the exact words for the chosen method", async () => {
    const db = memoryDb({ payment_methods: [card()] });
    await assert.rejects(() => enableAutopay(db, { userId: "l1", paymentMethodId: "m1", authorized: false, now }), (e) => e.code === "authorization_required");
    await enableAutopay(db, { userId: "l1", paymentMethodId: "m1", authorized: true, userAgent: "UA", now });
    const [auth] = db.tables.autopay_authorizations;
    assert.equal(auth.payment_method_id, "m1");
    assert.equal(auth.consent_text, consentText("Visa ending 4242, expires 12/2030"));
    assert.match(auth.consent_text, /5 business days after the invoice is emailed/);
    assert.equal(auth.user_agent, "UA");
  });

  it("refuses a bank account still verifying, a failed or expired method, and someone else's", async () => {
    const db = memoryDb({
      payment_methods: [
        card({ id: "bank", type: "us_bank_account", status: "verifying", bank_name: "Chase" }),
        card({ id: "failed", status: "failed" }),
        card({ id: "old", exp_year: 2025 }),
        card({ id: "theirs", user_id: "l2" }),
      ],
    });
    await assert.rejects(() => enableAutopay(db, { userId: "l1", paymentMethodId: "bank", authorized: true, now }), /still being verified/);
    await assert.rejects(() => enableAutopay(db, { userId: "l1", paymentMethodId: "failed", authorized: true, now }), (e) => e.code === "not_active");
    await assert.rejects(() => enableAutopay(db, { userId: "l1", paymentMethodId: "old", authorized: true, now }), (e) => e.code === "not_active");
    await assert.rejects(() => enableAutopay(db, { userId: "l1", paymentMethodId: "theirs", authorized: true, now }), (e) => e.code === "not_found");
    assert.equal(db.tables.autopay_authorizations?.length ?? 0, 0);
  });

  it("moving to another method keeps the old consent as history", async () => {
    const db = memoryDb({ payment_methods: [card(), card({ id: "m2", last4: "1111", stripe_payment_method_id: "pm_2" })] });
    await enableAutopay(db, { userId: "l1", paymentMethodId: "m1", authorized: true, now });
    await enableAutopay(db, { userId: "l1", paymentMethodId: "m2", authorized: true, now });
    const [first, second] = db.tables.autopay_authorizations;
    assert.equal(first.revoked_reason, "replaced");
    assert.equal(second.revoked_at, null);
    assert.equal(second.payment_method_id, "m2");
    const state = await autopayState(db, "l1", now);
    assert.equal(state.enabled, true);
    assert.match(state.method.description, /1111/);
    assert.equal(state.choices.length, 2);
  });

  it("switching method moves invoices waiting on autopay to it, with a fresh notice, and emails the new date", async () => {
    const sent = [];
    const db = memoryDb({
      payment_methods: [card(), card({ id: "m2", last4: "1111", stripe_payment_method_id: "pm_2" })],
      users: [landlord],
      billing_invoices: [
        { id: "soon", landlord_id: "l1", status: "open", total_cents: 5000, autopay_payment_method_id: "m1", autopay_scheduled_for: "2026-11-11T06:00:00.000Z", autopay_attempted_at: null },
        { id: "late", landlord_id: "l1", status: "open", total_cents: 7000, autopay_payment_method_id: "m1", autopay_scheduled_for: "2026-12-30T06:00:00.000Z", autopay_attempted_at: null },
        { id: "tried", landlord_id: "l1", status: "open", total_cents: 9000, autopay_payment_method_id: "m1", autopay_scheduled_for: "2026-11-09T06:00:00.000Z", autopay_attempted_at: "2026-11-09T14:00:00.000Z" },
      ],
    });
    await enableAutopay(db, { userId: "l1", paymentMethodId: "m1", authorized: true, now });
    const r = await enableAutopay(db, { userId: "l1", paymentMethodId: "m2", authorized: true, notify: { autopayMoved: async (x) => sent.push(x) }, now });
    assert.equal(r.moved, 2);
    const [soon, late, tried] = db.tables.billing_invoices;
    assert.equal(soon.autopay_payment_method_id, "m2");
    assert.equal(soon.autopay_scheduled_for, "2026-11-18T06:00:00.000Z", "5 business days after the switch (Nov 11 is a Fed holiday)");
    assert.equal(late.autopay_scheduled_for, "2026-12-30T06:00:00.000Z", "a later date is kept");
    assert.equal(tried.autopay_payment_method_id, "m1", "an attempted invoice is not moved");
    assert.equal(sent.length, 1);
    assert.match(sent[0].methodDescription, /1111/);
    assert.equal(sent[0].invoices.length, 2);
  });

  it("an admin turning it off emails the landlord; the landlord turning it off does not", async () => {
    const sent = [];
    const notify = { autopayOff: async (x) => sent.push(x) };
    const db = memoryDb({ payment_methods: [card()], users: [landlord] });
    await enableAutopay(db, { userId: "l1", paymentMethodId: "m1", authorized: true, now });
    await disableAutopay(db, { userId: "l1", reason: "landlord", notify, now });
    assert.equal(sent.length, 0);
    await enableAutopay(db, { userId: "l1", paymentMethodId: "m1", authorized: true, now });
    assert.deepEqual(await disableAutopay(db, { userId: "l1", reason: "admin", byId: "admin1", notify, now }), { wasOn: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0].reason, /Proximity turned it off/);
  });
});

// ── Scheduling ──────────────────────────────────────────────────────────────

describe("scheduleAutopay", () => {
  const invoice = { id: "i1", landlord_id: "l1", status: "open", autopay_scheduled_for: null };

  it("stamps the method and the date 5 business days after sending, once", async () => {
    const db = memoryDb({ payment_methods: [card()], billing_invoices: [{ ...invoice }] });
    await enableAutopay(db, { userId: "l1", paymentMethodId: "m1", authorized: true, now });
    const first = await scheduleAutopay(db, { invoiceId: "i1", landlordId: "l1", sentAt: "2026-11-02T20:00:00Z", now });
    assert.equal(first.scheduledFor, "2026-11-09T06:00:00.000Z");
    assert.match(first.methodDescription, /Visa ending 4242/);
    const again = await scheduleAutopay(db, { invoiceId: "i1", landlordId: "l1", sentAt: "2026-11-05T20:00:00Z", now });
    assert.equal(again.scheduledFor, "2026-11-09T06:00:00.000Z", "a repeat keeps the first date");
    assert.equal(db.tables.billing_invoices[0].autopay_payment_method_id, "m1");
  });

  it("does nothing without autopay", async () => {
    const db = memoryDb({ payment_methods: [card()], billing_invoices: [{ ...invoice }] });
    assert.equal(await scheduleAutopay(db, { invoiceId: "i1", landlordId: "l1", sentAt: now.toISOString(), now }), null);
    assert.equal(db.tables.billing_invoices[0].autopay_scheduled_for, null);
  });

  it("switches autopay off, and emails, when its card has expired since", async () => {
    const sent = [];
    const db = memoryDb({ payment_methods: [card()], billing_invoices: [{ ...invoice }], users: [landlord] });
    await enableAutopay(db, { userId: "l1", paymentMethodId: "m1", authorized: true, now });
    db.tables.payment_methods[0].exp_year = 2025;
    const r = await scheduleAutopay(db, { invoiceId: "i1", landlordId: "l1", sentAt: now.toISOString(), notify: { autopayOff: async (x) => sent.push(x) }, now });
    assert.equal(r, null);
    assert.equal(db.tables.autopay_authorizations[0].revoked_reason, "expired");
    assert.equal(sent.length, 1);
  });
});

// ── The daily job ───────────────────────────────────────────────────────────

function fakeStripe({ status = "open", payError = null, paidAfter = true } = {}) {
  const calls = { pay: [] };
  let current = status;
  return {
    calls,
    invoices: {
      retrieve: async (id) => ({ id, status: current, payments: { data: [] } }),
      pay: async (id, params, opts) => {
        calls.pay.push({ id, params, opts });
        if (payError) throw payError;
        if (paidAfter) current = "paid";
        return {};
      },
    },
    paymentIntents: { retrieve: async () => ({ status: "requires_payment_method" }) },
  };
}

async function setup(invoiceOver = {}) {
  const db = memoryDb({
    payment_methods: [card()],
    users: [landlord],
    billing_invoices: [{ id: "i1", landlord_id: "l1", status: "open", stripe_invoice_id: "in_1", total_cents: 5000, invoice_date: "2026-11-02", hosted_invoice_url: null, autopay_scheduled_for: null, autopay_attempted_at: null, ...invoiceOver }],
  });
  await enableAutopay(db, { userId: "l1", paymentMethodId: "m1", authorized: true, now: new Date("2026-11-01T00:00:00Z") });
  await scheduleAutopay(db, { invoiceId: "i1", landlordId: "l1", sentAt: "2026-11-02T20:00:00Z", now });
  return db;
}

describe("runAutopayJob", () => {
  it("waits for the date, then charges once with an idempotency key, and a re-run charges nothing", async () => {
    const db = await setup();
    const stripe = fakeStripe();
    assert.equal((await runAutopayJob(db, stripe, { now: new Date("2026-11-08T15:00:00Z") })).due, 0, "not yet");
    const r = await runAutopayJob(db, stripe, { now: new Date("2026-11-09T14:00:00Z") });
    assert.equal(r.charged, 1);
    assert.equal(stripe.calls.pay.length, 1);
    assert.equal(stripe.calls.pay[0].params.payment_method, "pm_1");
    assert.deepEqual(stripe.calls.pay[0].opts, { idempotencyKey: "autopay:in_1" });
    await runAutopayJob(db, stripe, { now: new Date("2026-11-09T18:00:00Z") });
    assert.equal(stripe.calls.pay.length, 1, "claimed: never charged twice");
  });

  it("skips an invoice paid by hand meanwhile, or whose autopay was turned off", async () => {
    const paid = await setup();
    paid.tables.billing_invoices[0].status = "paid";
    const stripe = fakeStripe();
    await runAutopayJob(paid, stripe, { now: new Date("2026-11-09T14:00:00Z") });
    assert.equal(paid.tables.billing_invoices[0].autopay_skipped_reason, "already paid");

    const off = await setup();
    await disableAutopay(off, { userId: "l1", now });
    await runAutopayJob(off, stripe, { now: new Date("2026-11-09T14:00:00Z") });
    assert.equal(off.tables.billing_invoices[0].autopay_skipped_reason, "autopay turned off");
    assert.equal(stripe.calls.pay.length, 0);
  });

  it("a decline is recorded once, emails the landlord, counts, and is not retried", async () => {
    const db = await setup();
    const failed = [];
    const notify = { paymentFailed: async (x) => failed.push(x), autopayOff: async () => {} };
    const stripe = fakeStripe({ payError: Object.assign(new Error("Your card was declined."), { code: "card_declined" }) });
    const r = await runAutopayJob(db, stripe, { now: new Date("2026-11-09T14:00:00Z"), notify });
    assert.equal(r.failed, 1);
    assert.equal(db.tables.billing_invoices[0].status, "failed");
    assert.equal(db.tables.billing_invoices[0].last_failure_message, "Your card was declined.");
    assert.equal(failed.length, 1);
    assert.equal(db.tables.autopay_authorizations[0].consecutive_failures, 1);
    assert.equal(db.tables.autopay_authorizations[0].revoked_at, null, "one failure keeps autopay on");
    await runAutopayJob(db, stripe, { now: new Date("2026-11-10T14:00:00Z"), notify });
    assert.equal(stripe.calls.pay.length, 1, "no automatic retry");
  });

  it("a Stripe error before charging releases the claim, and the next run charges", async () => {
    const db = await setup();
    const stripe = fakeStripe();
    const realRetrieve = stripe.invoices.retrieve;
    stripe.invoices.retrieve = async () => {
      throw new Error("Stripe 500");
    };
    const r = await runAutopayJob(db, stripe, { now: new Date("2026-11-09T14:00:00Z") });
    assert.equal(r.errors.length, 1);
    assert.equal(db.tables.billing_invoices[0].autopay_attempted_at, null, "claim released");
    stripe.invoices.retrieve = realRetrieve;
    const again = await runAutopayJob(db, stripe, { now: new Date("2026-11-10T14:00:00Z") });
    assert.equal(again.charged, 1);
    assert.equal(stripe.calls.pay.length, 1);
  });

  it("a claim cut short by a timeout is taken up again after six hours, once", async () => {
    const db = await setup();
    // A run claimed it and died before anything else happened.
    db.tables.billing_invoices[0].autopay_attempted_at = "2026-11-09T14:00:00.000Z";
    const stripe = fakeStripe();
    assert.equal((await runAutopayJob(db, stripe, { now: new Date("2026-11-09T17:00:00Z") })).due, 0, "too soon");
    const r = await runAutopayJob(db, stripe, { now: new Date("2026-11-09T21:00:00Z") });
    assert.equal(r.charged, 1);
    await runAutopayJob(db, stripe, { now: new Date("2026-11-10T21:00:00Z") });
    assert.equal(stripe.calls.pay.length, 1, "paid: never retried again");
  });

  it("a failure from before the claim (a declined Pay now) does not stop a cut-short claim being retried", async () => {
    const db = await setup({ failed_at: "2026-11-05T10:00:00.000Z" });
    db.tables.billing_invoices[0].autopay_attempted_at = "2026-11-09T14:00:00.000Z";
    const stripe = fakeStripe();
    const r = await runAutopayJob(db, stripe, { now: new Date("2026-11-09T21:00:00Z") });
    assert.equal(r.charged, 1);
  });

  it("an abandoned claim with a recorded failure, or one older than five days, is left alone", async () => {
    const failed = await setup({});
    Object.assign(failed.tables.billing_invoices[0], { autopay_attempted_at: "2026-11-09T14:00:00.000Z", failed_at: "2026-11-09T14:00:01.000Z" });
    const old = await setup({});
    old.tables.billing_invoices[0].autopay_attempted_at = "2026-11-01T14:00:00.000Z";
    const stripe = fakeStripe();
    await runAutopayJob(failed, stripe, { now: new Date("2026-11-10T14:00:00Z") });
    await runAutopayJob(old, stripe, { now: new Date("2026-11-10T14:00:00Z") });
    assert.equal(stripe.calls.pay.length, 0);
  });

  it("a second failure in a row switches autopay off and emails", async () => {
    const db = await setup();
    const off = [];
    await noteAutopayFailure(db, { landlordId: "l1", now });
    const r = await noteAutopayFailure(db, { landlordId: "l1", notify: { autopayOff: async (x) => off.push(x) }, now });
    assert.equal(r.switchedOff, true);
    assert.equal(db.tables.autopay_authorizations[0].revoked_reason, "failures");
    assert.match(off[0].reason, /last 2 autopay payments/);
  });

  it("a success resets the count", async () => {
    const db = await setup();
    db.tables.autopay_authorizations[0].consecutive_failures = 1;
    await runAutopayJob(db, fakeStripe(), { now: new Date("2026-11-09T14:00:00Z") });
    assert.equal(db.tables.autopay_authorizations[0].consecutive_failures, 0);
  });

  it("switches off autopay whose method was removed, emailing once", async () => {
    const db = await setup();
    const off = [];
    db.tables.payment_methods[0].deleted_at = "2026-11-05";
    const notify = { autopayOff: async (x) => off.push(x) };
    const r = await runAutopayJob(db, fakeStripe(), { now: new Date("2026-11-09T14:00:00Z"), notify });
    assert.equal(r.switchedOff, 1);
    assert.equal(r.charged, 0);
    assert.equal(off.length, 1);
    await runAutopayJob(db, fakeStripe(), { now: new Date("2026-11-10T14:00:00Z"), notify });
    assert.equal(off.length, 1);
  });
});

describe("revokeAutopayForMethod", () => {
  it("only touches autopay on that method", async () => {
    const db = memoryDb({ payment_methods: [card(), card({ id: "m2", stripe_payment_method_id: "pm_2" })], users: [landlord] });
    await enableAutopay(db, { userId: "l1", paymentMethodId: "m1", authorized: true, now });
    assert.equal(await revokeAutopayForMethod(db, { paymentMethodId: "m2", reason: "removed", now }), 0);
    assert.equal(await revokeAutopayForMethod(db, { paymentMethodId: "m1", reason: "removed", now }), 1);
  });
});

// ── The overdue clock and the invoice view ──────────────────────────────────

describe("overdue counts 30 days from the due date (decisions of 2026-11-04)", () => {
  const inv = { status: "open", invoice_date: "2026-11-02T00:00:00Z", due_date: "2026-12-02T00:00:00Z" };

  it("is not overdue 31 days after the invoice date, only 30 days after the due date", () => {
    assert.equal(isInvoiceOverdue(inv, new Date("2026-12-04T00:00:00Z")), false);
    assert.equal(isInvoiceOverdue(inv, new Date("2027-01-01T00:00:00Z")), false);
    assert.equal(isInvoiceOverdue(inv, new Date("2027-01-02T00:00:01Z")), true);
    assert.equal(invoiceAttentionReason(inv, new Date("2027-01-02T00:00:01Z")), "overdue");
  });

  it("an older invoice without a due date still counts from its invoice date", () => {
    const old = { status: "open", invoice_date: "2026-11-02T00:00:00Z" };
    assert.equal(isInvoiceOverdue(old, new Date("2026-12-03T00:00:00Z")), true);
  });
});

describe("invoiceView", () => {
  const row = { id: "i1", billing_period: "2026-11-01", status: "open", total_cents: 5000, invoice_date: "2026-11-02", due_date: "2026-12-02", autopay_scheduled_for: "2026-11-09T06:00:00Z", autopay_attempted_at: null };
  it("shows the due date and the coming autopay date, and drops it once tried", () => {
    assert.equal(invoiceView(row).dueDate, "2026-12-02");
    assert.equal(invoiceView(row).autopayDate, "2026-11-09T06:00:00Z");
    assert.equal(invoiceView({ ...row, autopay_attempted_at: "2026-11-09" }).autopayDate, null);
    assert.equal(invoiceView({ ...row, status: "paid" }).autopayDate, null);
  });
});

// ── The emails ──────────────────────────────────────────────────────────────

describe("invoice and autopay emails", () => {
  const base = {
    name: "Pat",
    periodLabel: "November 2026",
    lines: [
      { description: "Lease signed | Listing: 1 Main St", amountCents: 12000, signedRentCents: 150000, commissionRatePercent: 8 },
      { description: "Test charge", amountCents: 500 },
    ],
    totalCents: 12500,
    dueDate: "2026-12-02T20:00:00Z",
    payUrl: "https://app/pay",
    hostedUrl: "https://stripe/inv",
  };

  it("lists each line with its basis, the due date and Pay now, and says nothing is charged", () => {
    const { subject, html } = invoiceIssuedEmail(base);
    assert.match(subject, /November 2026: \$125\.00/);
    assert.match(html, /8% of \$1,500\.00 signed rent/);
    assert.match(html, /due by <strong>December 2, 2026<\/strong>/);
    assert.match(html, /Nothing is charged automatically/);
    assert.match(html, />Pay now</);
    assert.match(html, /https:\/\/stripe\/inv/);
  });

  it("with autopay, names the method and the date (the notice before the debit)", () => {
    const { html } = invoiceIssuedEmail({ ...base, autopay: { methodDescription: "Chase account ending 6789", scheduledFor: "2026-11-09T06:00:00Z" } });
    assert.match(html, /We will charge Chase account ending 6789 for \$125\.00 on November 9, 2026/);
  });

  it("escapes what came from people", () => {
    const { html } = invoiceIssuedEmail({ ...base, lines: [{ description: "<script>x</script>", amountCents: 500 }] });
    assert.doesNotMatch(html, /<script>/);
  });

  it("autopay off says why and how to turn it back on", () => {
    const { html } = autopayOffEmail({ name: "Pat", reason: "the card it used has expired", methodDescription: "Visa ending 4242", paymentsUrl: "https://app/p" });
    assert.match(html, /because the card it used has expired \(Visa ending 4242\)/);
    assert.match(html, /Choose a payment method/);
  });

  it("basisLabel", () => {
    assert.equal(basisLabel({ signedRentCents: 150000, commissionRatePercent: 8 }), "8% of $1,500.00 signed rent");
    assert.equal(basisLabel({ commissionRatePercent: "7.5" }), "Commission rate 7.5%");
    assert.equal(basisLabel({}), null);
  });
});
