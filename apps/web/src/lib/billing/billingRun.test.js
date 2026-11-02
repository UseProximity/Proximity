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
import { assertInvoiceMatches, paymentFailureMessage, periodLabel, recordPaymentFailure } from "./invoicing.js";
import { invoiceView } from "./invoiceAccess.js";
import { adjustPaidCharge } from "./adjustments.js";
import { BILLING_RUN_ENABLED, getBillingSetting } from "./settings.js";

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

  it("always says something", () => {
    assert.equal(paymentFailureMessage({}), "The payment did not go through.");
    assert.equal(paymentFailureMessage(null), "The payment did not go through.");
  });
});

describe("invoiceView", () => {
  const row = { id: "i1", billing_period: "2027-01-01", total_cents: 5000, invoice_date: "2027-01-04", hosted_invoice_url: "https://h", invoice_pdf_url: "https://p", last_failure_message: "declined" };

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
