/*
 * Run with: npm test (from apps/web).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { billingPeriodFor, firstMondayOfMonth, isBillingDay } from "./billingPeriod.js";
import { TRANSITIONS, canTransition, isReviewOver, landlordActions, reviewEndsAt, summarizeBalance } from "./chargeLifecycle.js";
import { invoiceIdempotencyKey, lineDescription, planInvoices, triggerLabel } from "./invoicePlan.js";
import { describeMethod, effectiveStatus, hasActivePaymentMethod, isCardExpired, needsAttention } from "./paymentMethodState.js";
import { isInvoiceOverdue } from "./overdue.js";
import { dollarsToCents, formatCents } from "./money.js";
import { CHARGE_STATUSES } from "./constants.js";

const at = (iso) => new Date(iso);

describe("billing day (first Monday, America/Chicago)", () => {
  it("finds the first Monday of a month", () => {
    assert.equal(firstMondayOfMonth(2024, 1), 1); // 1 Jan 2024 was a Monday
    assert.equal(firstMondayOfMonth(2024, 3), 4); // 1 Mar 2024 was a Friday
    assert.equal(firstMondayOfMonth(2026, 11), 2); // 1 Nov 2026 is a Sunday
    assert.equal(firstMondayOfMonth(2026, 12), 7); // 1 Dec 2026 is a Tuesday
  });

  it("is the billing day only on that Monday", () => {
    assert.equal(isBillingDay(at("2026-11-02T15:00:00Z")), true);
    assert.equal(isBillingDay(at("2026-11-09T15:00:00Z")), false); // second Monday
    assert.equal(isBillingDay(at("2026-11-03T15:00:00Z")), false); // Tuesday
    assert.equal(isBillingDay(at("2026-12-07T15:00:00Z")), true);
  });

  it("uses the Chicago date, not the UTC date", () => {
    // 04:00Z on Tuesday 3 Nov is still Monday evening in Chicago (CST, UTC-6).
    assert.equal(isBillingDay(at("2026-11-03T04:00:00Z")), true);
    // 05:00Z on Monday 2 Nov is Sunday night in Chicago.
    assert.equal(isBillingDay(at("2026-11-02T05:00:00Z")), false);
  });

  it("handles the daylight saving switch", () => {
    assert.equal(isBillingDay(at("2024-03-04T14:00:00Z")), true); // CST, before the 10 Mar switch
    assert.equal(isBillingDay(at("2024-04-01T14:00:00Z")), true); // CDT, 1 Apr 2024 was a Monday
  });

  it("names the period by the Chicago month", () => {
    assert.equal(billingPeriodFor(at("2026-11-02T15:00:00Z")), "2026-11-01");
    // 04:30Z on 1 Nov is 23:30 on 31 Oct in Chicago (CDT), still October.
    assert.equal(billingPeriodFor(at("2026-11-01T04:30:00Z")), "2026-10-01");
  });
});

describe("charge lifecycle", () => {
  it("matches the database transition table", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../../../../supabase/migrations/202610310001_billing_core.sql", import.meta.url)),
      "utf8"
    );
    const fn = sql.slice(sql.indexOf("fn_charge_transition_allowed(p_from"));
    const fromSql = {};
    for (const [, from, list] of fn.matchAll(/WHEN '(\w+)'\s+THEN p_to IN \(([^)]*)\)/g)) {
      fromSql[from] = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    }
    for (const status of CHARGE_STATUSES) {
      assert.deepEqual([...(TRANSITIONS[status] ?? [])].sort(), fromSql[status] ?? [], `from ${status}`);
    }
  });

  it("allows the PRD moves and nothing else", () => {
    assert.ok(canTransition("unconfirmed", "pending"));
    assert.ok(canTransition("pending", "approved"));
    assert.ok(canTransition("contested", "voided"));
    assert.ok(canTransition("invoiced", "paid"));
    assert.ok(!canTransition("pending", "paid"));
    assert.ok(!canTransition("paid", "voided"));
    assert.ok(!canTransition("approved", "contested"));
    assert.ok(!canTransition("voided", "approved"));
  });

  it("ends review 7 days after the charge entered Pending", () => {
    const charge = { status: "pending", pending_at: "2026-11-01T12:00:00Z" };
    assert.equal(reviewEndsAt(charge).toISOString(), "2026-11-08T12:00:00.000Z");
    assert.equal(isReviewOver(charge, at("2026-11-08T11:59:59Z")), false);
    assert.equal(isReviewOver(charge, at("2026-11-08T12:00:00Z")), true);
  });

  it("only Pending charges have a review clock", () => {
    assert.equal(reviewEndsAt({ status: "unconfirmed", pending_at: null }), null);
    assert.equal(isReviewOver({ status: "approved", pending_at: "2020-01-01T00:00:00Z" }), false);
  });

  it("offers Approve and Contest only while a charge is in review", () => {
    assert.deepEqual(landlordActions({ status: "unconfirmed" }), { approve: true, contest: true, contactForDispute: false });
    assert.deepEqual(landlordActions({ status: "pending" }), { approve: true, contest: true, contactForDispute: false });
    assert.deepEqual(landlordActions({ status: "approved" }), { approve: false, contest: false, contactForDispute: true });
    assert.deepEqual(landlordActions({ status: "paid" }), { approve: false, contest: false, contactForDispute: true });
    assert.deepEqual(landlordActions({ status: "contested" }), { approve: false, contest: false, contactForDispute: false });
  });

  it("balance counts approved and uninvoiced; review counts unconfirmed and pending", () => {
    const charges = [
      { status: "approved", amount_cents: 1000, invoice_id: null },
      { status: "approved", amount_cents: 300, invoice_id: "inv" },
      { status: "unconfirmed", amount_cents: 200 },
      { status: "pending", amount_cents: 400 },
      { status: "contested", amount_cents: 999 },
      { status: "voided", amount_cents: 999 },
      { status: "paid", amount_cents: 999 },
    ];
    assert.deepEqual(summarizeBalance(charges), { balanceCents: 1000, inReviewCents: 600 });
  });
});

describe("invoice plan", () => {
  const base = { status: "approved", invoice_id: null, created_at: "2026-10-01T00:00:00Z" };
  const charge = (id, landlord, cents, extra = {}) => ({ ...base, id, landlord_id: landlord, amount_cents: cents, trigger_type: "finalize_deal", ...extra });

  it("makes one invoice per landlord with one line per charge", () => {
    const plan = planInvoices(
      [charge("c1", "L1", 3000), charge("c2", "L1", 2000), charge("c3", "L2", 5000)],
      { billingPeriod: "2026-11-01" }
    );
    assert.equal(plan.invoices.length, 2);
    const l1 = plan.invoices.find((i) => i.landlordId === "L1");
    assert.equal(l1.totalCents, 5000);
    assert.deepEqual(l1.lines.map((l) => l.chargeId), ["c1", "c2"]);
    assert.equal(l1.idempotencyKey, "invoice:L1:2026-11-01");
    assert.equal(plan.grandTotalCents, 10000);
  });

  it("only bills approved charges that are not already on an invoice", () => {
    const plan = planInvoices(
      [
        charge("a", "L1", 1000),
        charge("b", "L1", 1000, { status: "pending" }),
        charge("c", "L1", 1000, { status: "contested" }),
        charge("d", "L1", 1000, { status: "voided" }),
        charge("e", "L1", 1000, { status: "unconfirmed" }),
        charge("f", "L1", 1000, { invoice_id: "inv_x", status: "approved" }),
      ],
      { billingPeriod: "2026-11-01" }
    );
    assert.deepEqual(plan.invoices[0].lines.map((l) => l.chargeId), ["a"]);
  });

  it("defers a landlord under the minimum and bills at exactly the minimum", () => {
    const under = planInvoices([charge("u", "L1", 499)], { billingPeriod: "2026-11-01" });
    assert.equal(under.invoices.length, 0);
    assert.deepEqual(under.deferred, [{ landlordId: "L1", totalCents: 499, chargeCount: 1 }]);

    const exact = planInvoices([charge("x", "L1", 500)], { billingPeriod: "2026-11-01" });
    assert.equal(exact.invoices.length, 1);
    assert.equal(exact.deferred.length, 0);
  });

  it("several small charges that add up to the minimum are billed together", () => {
    const plan = planInvoices([charge("a", "L1", 300), charge("b", "L1", 200)], { billingPeriod: "2026-11-01" });
    assert.equal(plan.invoices[0].totalCents, 500);
  });

  it("builds the same plan however the rows arrive", () => {
    const rows = [
      charge("c2", "L1", 1000, { created_at: "2026-10-02T00:00:00Z" }),
      charge("c1", "L1", 1000, { created_at: "2026-10-01T00:00:00Z" }),
    ];
    const a = planInvoices(rows, { billingPeriod: "2026-11-01" });
    const b = planInvoices([...rows].reverse(), { billingPeriod: "2026-11-01" });
    assert.deepEqual(a, b);
  });

  it("describes a line with trigger, listing, lease and student", () => {
    assert.equal(
      lineDescription({ trigger_type: "student_review_outcome", listing_label: "123 Main St", lease_label: "Unit 2, 12-month", student_name: "Sam Lee" }),
      "Student review outcome | Listing: 123 Main St | Lease: Unit 2, 12-month | Student: Sam Lee"
    );
    assert.equal(lineDescription({ trigger_type: "test" }), "Test");
    assert.equal(triggerLabel(""), "Charge");
    assert.ok(lineDescription({ trigger_type: "x", listing_label: "y".repeat(900) }).length <= 400);
  });

  it("keys an invoice by landlord and period", () => {
    assert.equal(invoiceIdempotencyKey("L", "2026-11-01"), "invoice:L:2026-11-01");
  });
});

describe("payment method state", () => {
  const now = at("2026-11-15T00:00:00Z");

  it("a card is good through the end of its expiry month", () => {
    assert.equal(isCardExpired(11, 2026, now), false);
    assert.equal(isCardExpired(10, 2026, now), true);
    assert.equal(isCardExpired(12, 2025, now), true);
    assert.equal(isCardExpired(1, 2027, now), false);
    assert.equal(isCardExpired(null, null, now), false);
  });

  it("shows an active card past its expiry as expired", () => {
    assert.equal(effectiveStatus({ type: "card", status: "active", exp_month: 10, exp_year: 2026 }, now), "expired");
    assert.equal(effectiveStatus({ type: "card", status: "active", exp_month: 12, exp_year: 2026 }, now), "active");
    assert.equal(effectiveStatus({ type: "us_bank_account", status: "verifying" }, now), "verifying");
    assert.equal(effectiveStatus({ type: "card", status: "failed", exp_month: 12, exp_year: 2030 }, now), "failed");
  });

  it("prompts only for expired or failed", () => {
    assert.deepEqual(["verifying", "active", "expired", "failed"].map(needsAttention), [false, false, true, true]);
  });

  it("describes a card and a bank account", () => {
    assert.equal(describeMethod({ type: "card", brand: "visa", last4: "4242", exp_month: 4, exp_year: 2028 }), "Visa ending 4242, expires 04/2028");
    assert.equal(describeMethod({ type: "us_bank_account", bank_name: "STRIPE TEST BANK", last4: "6789" }), "STRIPE TEST BANK account ending 6789");
    assert.equal(describeMethod({ type: "us_bank_account", last4: "6789" }), "Bank account ending 6789");
  });

  it("clears the gate only with an active, undeleted method", () => {
    const ok = { type: "us_bank_account", status: "active" };
    assert.equal(hasActivePaymentMethod([ok], now), true);
    assert.equal(hasActivePaymentMethod([{ ...ok, status: "verifying" }], now), false);
    assert.equal(hasActivePaymentMethod([{ ...ok, deleted_at: "2026-01-01" }], now), false);
    assert.equal(hasActivePaymentMethod([{ type: "card", status: "active", exp_month: 1, exp_year: 2026 }], now), false);
    assert.equal(hasActivePaymentMethod([], now), false);
  });
});

describe("overdue invoices", () => {
  const now = at("2026-12-10T00:00:00Z");
  const invoice = (over) => ({ status: "open", invoice_date: "2026-11-10T00:00:00Z", overdue_actioned_at: null, ...over });

  it("is overdue only after more than 30 days from the invoice date", () => {
    assert.equal(isInvoiceOverdue(invoice({ invoice_date: "2026-11-10T00:00:00Z" }), now), false); // exactly 30 days
    assert.equal(isInvoiceOverdue(invoice({ invoice_date: "2026-11-09T23:59:59Z" }), now), true);
  });

  it("counts open and failed invoices, not paid, void or uncollectible", () => {
    const old = { invoice_date: "2026-01-01T00:00:00Z" };
    assert.equal(isInvoiceOverdue(invoice({ ...old, status: "open" }), now), true);
    assert.equal(isInvoiceOverdue(invoice({ ...old, status: "failed" }), now), true);
    for (const status of ["paid", "void", "uncollectible"]) {
      assert.equal(isInvoiceOverdue(invoice({ ...old, status }), now), false, status);
    }
  });

  it("pauses while an ACH payment is processing", () => {
    assert.equal(isInvoiceOverdue(invoice({ invoice_date: "2026-01-01T00:00:00Z", status: "processing" }), now), false);
  });

  it("never actions an invoice twice", () => {
    assert.equal(isInvoiceOverdue(invoice({ invoice_date: "2026-01-01T00:00:00Z", overdue_actioned_at: "2026-12-01" }), now), false);
  });
});

describe("money", () => {
  it("formats cents as dollars", () => {
    assert.equal(formatCents(0), "$0.00");
    assert.equal(formatCents(5), "$0.05");
    assert.equal(formatCents(123456), "$1,234.56");
    assert.equal(formatCents(null), "$0.00");
  });

  it("parses dollars to cents and rejects anything ambiguous", () => {
    assert.equal(dollarsToCents("12.50"), 1250);
    assert.equal(dollarsToCents("$5"), 500);
    assert.equal(dollarsToCents(0.1 + 0.2), null); // too many decimals
    assert.equal(dollarsToCents("0"), null);
    assert.equal(dollarsToCents("-3"), null);
    assert.equal(dollarsToCents("1.234"), null);
    assert.equal(dollarsToCents("abc"), null);
    assert.equal(dollarsToCents(""), null);
  });
});
