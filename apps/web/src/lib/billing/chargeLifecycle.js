/*
 * The charge lifecycle as plain functions, for the dashboard, admin view and
 * crons to decide what is allowed and what to show. The database is the
 * authority (trg_charges_enforce_transition in 202610310001 rejects an illegal
 * move), so TRANSITIONS must match fn_charge_transition_allowed there; the
 * tests pin the table.
 *
 *   unconfirmed  created by a trigger, not yet confirmed. Visible, never collected
 *   pending      an admin confirmed it; 7 day review. Not collected
 *   approved     ready to collect on the next billing run
 *   invoiced     on a monthly invoice, payment not complete
 *   paid         the invoice was paid
 *   contested    the landlord contested it
 *   voided       will not be collected
 */
import { DAY_MS, REVIEW_DAYS } from "./constants.js";

export const TRANSITIONS = {
  unconfirmed: ["pending", "approved", "contested", "voided"],
  pending: ["approved", "contested", "voided"],
  contested: ["approved", "voided"],
  approved: ["invoiced", "voided"],
  invoiced: ["paid", "approved", "voided"],
  paid: [],
  voided: [],
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

// When a Pending charge's review period ends. Null for any other status, and
// for a Pending row with no clock start (should not happen).
export function reviewEndsAt(charge) {
  if (charge?.status !== "pending" || !charge.pending_at) return null;
  return new Date(new Date(charge.pending_at).getTime() + REVIEW_DAYS * DAY_MS);
}

// True once the 7 days are up: the review cron then approves it.
export function isReviewOver(charge, now = new Date()) {
  const ends = reviewEndsAt(charge);
  return ends !== null && now.getTime() >= ends.getTime();
}

// What the landlord may do. Approved and Paid charges cannot be contested in
// the app; the dashboard tells them to contact the team for a formal dispute.
export function landlordActions(charge) {
  const inReview = charge?.status === "unconfirmed" || charge?.status === "pending";
  return {
    approve: inReview,
    contest: inReview,
    contactForDispute: ["approved", "invoiced", "paid"].includes(charge?.status),
  };
}

// The two figures at the top of the payments dashboard: what the next run will
// collect, and what is still under review. Contested and voided count in neither.
export function summarizeBalance(charges) {
  let balanceCents = 0;
  let inReviewCents = 0;
  for (const c of charges ?? []) {
    if (c.status === "approved" && !c.invoice_id) balanceCents += c.amount_cents;
    else if (c.status === "unconfirmed" || c.status === "pending") inReviewCents += c.amount_cents;
  }
  return { balanceCents, inReviewCents };
}
