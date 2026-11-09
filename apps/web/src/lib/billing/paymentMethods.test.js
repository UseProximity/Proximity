/*
 * Run with: npm test (from apps/web).
 *
 * The parts of payment method handling that need no database or Stripe. The rest
 * (recording, default switching, removal) is exercised against the sandbox.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { displayFields, setupSessionParams, statusForSetupIntent } from "./paymentMethods.js";
import { BillingError } from "./errors.js";

describe("setupSessionParams", () => {
  const base = { customerId: "cus_1", userId: "u1", baseUrl: "http://localhost:3000" };

  it("creates a hosted setup session for the landlord's customer, one type at a time", () => {
    const p = setupSessionParams({ ...base, type: "card" });
    assert.equal(p.mode, "setup");
    assert.equal(p.customer, "cus_1");
    assert.deepEqual(p.allowed_payment_method_types, ["card"]);
    assert.equal(p.metadata.user_id, "u1");
    assert.equal(p.setup_intent_data.metadata.user_id, "u1");
    assert.equal(p.payment_method_options, undefined);
  });

  it("verifies bank accounts through Financial Connections", () => {
    const p = setupSessionParams({ ...base, type: "us_bank_account" });
    assert.deepEqual(p.allowed_payment_method_types, ["us_bank_account"]);
    assert.deepEqual(p.payment_method_options.us_bank_account.financial_connections.permissions, ["payment_method"]);
    assert.equal(p.payment_method_options.us_bank_account.verification_method, "automatic");
  });

  it("returns to the payments tab, keeping Stripe's session id placeholder", () => {
    const p = setupSessionParams({ ...base, type: "card" });
    assert.equal(
      p.success_url,
      "http://localhost:3000/dashboard/landlord?tab=billing&setup=success&session_id={CHECKOUT_SESSION_ID}"
    );
    assert.equal(p.cancel_url, "http://localhost:3000/dashboard/landlord?tab=billing&setup=cancelled");
  });

  it("refuses any other payment method type", () => {
    for (const type of ["paypal", "", undefined, "us_bank_account; drop"]) {
      assert.throws(() => setupSessionParams({ ...base, type }), BillingError);
    }
  });
});

describe("statusForSetupIntent", () => {
  it("maps Stripe's setup intent states to ours", () => {
    assert.equal(statusForSetupIntent("succeeded"), "active");
    assert.equal(statusForSetupIntent("requires_action"), "verifying");
    assert.equal(statusForSetupIntent("processing"), "verifying");
    assert.equal(statusForSetupIntent("requires_payment_method"), "failed");
    assert.equal(statusForSetupIntent("canceled"), "failed");
  });
});

describe("displayFields", () => {
  it("keeps only display details for a card", () => {
    const f = displayFields({
      id: "pm_1",
      type: "card",
      card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2028, number: "never stored", fingerprint: "x" },
    });
    assert.deepEqual(f, { type: "card", brand: "visa", last4: "4242", exp_month: 4, exp_year: 2028, bank_name: null });
  });

  it("keeps only the bank name and last four for a bank account", () => {
    const f = displayFields({
      id: "pm_2",
      type: "us_bank_account",
      us_bank_account: { bank_name: "STRIPE TEST BANK", last4: "6789", routing_number: "110000000" },
    });
    assert.deepEqual(f, { type: "us_bank_account", brand: null, last4: "6789", exp_month: null, exp_year: null, bank_name: "STRIPE TEST BANK" });
    assert.ok(!JSON.stringify(f).includes("110000000"));
  });

  it("ignores payment method types we do not support", () => {
    assert.equal(displayFields({ id: "pm_3", type: "link" }), null);
  });
});
