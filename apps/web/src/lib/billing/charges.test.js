/*
 * Run with: npm test (from apps/web).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { leaseLabel, chargeView, statusMessage, adminChargeView } from "./chargeDisplay.js";
import { adminResolveContest, adminVoidCharge } from "./adminReview.js";
import { CHARGE_STATUSES } from "./constants.js";
import { createCharge, landlordApprove, landlordContest, transitionError } from "./charges.js";
import { BillingError } from "./errors.js";

describe("transitionError", () => {
  it("turns what rpc_transition_charge raises into messages a landlord can read", () => {
    const cases = [
      ["charge_not_found", "not_found", 404],
      ["charge_status_changed", "status_changed", 409],
      ["charge_note_required", "note_required", 400],
      ["invalid charge transition pending -> paid", "not_allowed", 409],
    ];
    for (const [message, code, status] of cases) {
      const e = transitionError({ message });
      assert.ok(e instanceof BillingError, message);
      assert.equal(e.code, code);
      assert.equal(e.status, status);
    }
  });

  it("leaves anything unexpected alone, so it is logged and shown as a generic error", () => {
    const raw = { message: "connection reset" };
    assert.equal(transitionError(raw), raw);
  });
});

describe("leaseLabel", () => {
  it("names the unit and the term", () => {
    assert.equal(leaseLabel({ lease_term_months: [12], listing_units: { name: "Unit 2" } }), "Unit 2, 12-month");
    assert.equal(leaseLabel({ lease_term_months: [10, 12], listing_units: { unit_designator: "Apt", unit_number: "3B" } }), "Apt 3B, 10 or 12-month");
    assert.equal(leaseLabel({ lease_term_months: [12], listing_units: { unit_designator: "Whole" } }), "Whole property, 12-month");
    assert.equal(leaseLabel({ lease_term_months: [], listing_units: { bedrooms: 2 } }), "2 bed");
  });

  it("is null when there is nothing to say", () => {
    assert.equal(leaseLabel(null), null);
    assert.equal(leaseLabel({ lease_term_months: null, listing_units: null }), null);
  });
});

describe("chargeView", () => {
  const row = {
    id: "c1", amount_cents: 12500, description: "d", trigger_type: "finalize_deal", status: "pending",
    created_at: "2026-11-01T00:00:00Z", pending_at: "2026-11-01T12:00:00Z", contest_reason: null,
    resolution_note: "INTERNAL",
    listing: { title: "The Loop", address: "123 Main St" },
    lease: { lease_term_months: [12], listing_units: { name: "Unit 2" } },
    student: { name: "Sam Lee" },
  };

  it("shows the listing, lease and student, and when review ends", () => {
    const v = chargeView(row);
    assert.equal(v.listingLabel, "123 Main St");
    assert.equal(v.leaseLabel, "Unit 2, 12-month");
    assert.equal(v.studentName, "Sam Lee");
    assert.equal(v.triggerLabel, "Finalize deal");
    assert.equal(v.reviewEndsAt, "2026-11-08T12:00:00.000Z");
    assert.deepEqual(v.actions, { approve: true, contest: true, contactForDispute: false });
  });

  it("never carries the admin's internal note", () => {
    assert.ok(!JSON.stringify(chargeView(row)).includes("INTERNAL"));
  });
});

describe("adminChargeView", () => {
  const row = {
    id: "c1", landlord_id: "l1", amount_cents: 5000, trigger_type: "finalize_deal", trigger_ref: "ref-9",
    status: "contested", created_at: "2026-11-01T00:00:00Z", contested_at: "2026-11-02T00:00:00Z",
    contest_reason: "wrong", resolution_note: "INTERNAL", is_test: true,
    landlord: { name: "Pat", email: "pat@x.com" }, listing: { address: "123 Main St" },
    lease: null, student: { name: "Sam" },
  };

  it("adds the landlord and the internal note for admins", () => {
    const v = adminChargeView(row);
    assert.deepEqual(v.landlord, { id: "l1", name: "Pat", email: "pat@x.com" });
    assert.equal(v.resolutionNote, "INTERNAL");
    assert.equal(v.isTest, true);
    assert.equal(v.triggerRef, "ref-9");
    assert.equal(v.contestReason, "wrong");
  });

  it("the landlord's view of the same row still has no internal note", () => {
    assert.ok(!JSON.stringify(chargeView(row)).includes("INTERNAL"));
  });
});

describe("admin actions validate before touching the database", () => {
  const db = { from() { throw new Error("should not reach the database"); }, rpc() { throw new Error("should not reach the database"); } };

  it("resolving a contest needs a valid outcome and a written note", async () => {
    await assert.rejects(() => adminResolveContest(db, { chargeId: "c", adminId: "a", outcome: "paid", note: "x" }), /approved or voided/);
    await assert.rejects(() => adminResolveContest(db, { chargeId: "c", adminId: "a", outcome: "approved", note: " " }), /note is required/);
  });

  it("voiding needs a written note", async () => {
    await assert.rejects(() => adminVoidCharge(db, { chargeId: "c", adminId: "a", note: "" }), /note is required/);
  });
});

describe("statusMessage", () => {
  it("says something plain for every status, and never an em dash", () => {
    const dash = String.fromCharCode(0x2014);
    for (const status of CHARGE_STATUSES) {
      const text = statusMessage({ status, reviewEndsAt: null });
      assert.ok(text.length > 0, status);
      assert.ok(!text.includes(dash), status);
    }
  });

  it("tells the landlord approved charges go on the next monthly invoice", () => {
    assert.match(statusMessage({ status: "approved" }), /next monthly invoice/);
    assert.match(statusMessage({ status: "voided" }), /not be charged/);
  });
});

describe("createCharge validation", () => {
  const db = { from() { throw new Error("should not reach the database"); } };

  it("rejects a bad amount or missing trigger before touching the database", async () => {
    for (const amountCents of [0, -5, 12.5, "100", null, undefined]) {
      await assert.rejects(() => createCharge(db, { landlordId: "l", amountCents, triggerType: "x" }), /positive number of cents/);
    }
    await assert.rejects(() => createCharge(db, { landlordId: "l", amountCents: 100, triggerType: "  " }), /trigger type/);
  });
});

describe("landlord actions", () => {
  // A db that returns no charge for this landlord: someone else's charge looks like no charge.
  const emptyDb = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
  };

  it("someone else's charge is simply not found", async () => {
    await assert.rejects(() => landlordApprove(emptyDb, { userId: "u", chargeId: "c" }), /not found/i);
    await assert.rejects(() => landlordContest(emptyDb, { userId: "u", chargeId: "c", reason: "wrong" }), /not found/i);
  });

  it("a contest needs a reason, and not an endless one", async () => {
    await assert.rejects(() => landlordContest(emptyDb, { userId: "u", chargeId: "c", reason: "   " }), /why you are contesting/);
    await assert.rejects(() => landlordContest(emptyDb, { userId: "u", chargeId: "c", reason: "x".repeat(2001) }), /under 2000/);
  });
});
