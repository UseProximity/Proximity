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
import { periodLabel, recordPaymentFailure } from "./invoicing.js";
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
