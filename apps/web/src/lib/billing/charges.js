/*
 * Charges: creating them and the landlord's side of their lifecycle.
 *
 * A charge belongs to a landlord user, never to a listing. Every status change
 * goes through rpc_transition_charge, which locks the row, checks the status the
 * caller thought it had, and writes the history row in the same transaction. So
 * a landlord approving while the review cron runs, or two admins resolving the
 * same contest, get a clean 409 for the loser instead of both writing.
 *
 * `db` is a service-role Supabase client, passed in so this stays testable.
 */
import { BillingError } from "./errors.js";
import { coveringAgreement } from "./agreements.js";
import { canTransition } from "./chargeLifecycle.js";
import { chargeView } from "./chargeDisplay.js";
import { linkForListing, payerRoleLinksFor } from "./payerLinks.js";

const MAX_REASON_LENGTH = 2000;

// The landlord-facing columns. resolution_note is the admin's internal note and
// is never sent to a landlord.
const LANDLORD_COLUMNS = `
  id, landlord_id, payer_id, listing_id, amount_cents, description, trigger_type, status, created_at,
  pending_at, paid_at, voided_at, contest_reason, signed_rent_cents, commission_rate_percent,
  listing:listings!listing_id(title, address),
  lease:unit_leases!lease_id(lease_term_months, listing_units!unit_id(name, unit_designator, unit_number, bedrooms)),
  student:users!student_id(name),
  adjustments:charge_adjustments(kind, amount_cents, created_at)
`;

// What rpc_transition_charge raises, as an error the caller can show.
export function transitionError(error) {
  const text = String(error?.message ?? "");
  if (text.includes("charge_not_found")) return new BillingError("not_found", "Charge not found.", 404);
  if (text.includes("charge_status_changed")) {
    return new BillingError("status_changed", "This charge was just updated. Refresh and try again.", 409);
  }
  if (text.includes("charge_note_required")) return new BillingError("note_required", "A reason is required.", 400);
  if (text.includes("invalid charge transition")) {
    return new BillingError("not_allowed", "That is not possible for this charge.", 409);
  }
  return error;
}

export async function transitionCharge(
  db,
  { chargeId, expectedFrom, to, actorType, actorUserId = null, note = null, invoiceId = null, stripeInvoiceItemId = null }
) {
  const { data, error } = await db.rpc("rpc_transition_charge", {
    p_charge_id: chargeId,
    p_expected_from: expectedFrom,
    p_to: to,
    p_actor_type: actorType,
    p_actor_user_id: actorUserId,
    p_note: note,
    p_invoice_id: invoiceId,
    p_stripe_invoice_item_id: stripeInvoiceItemId,
  });
  if (error) throw transitionError(error);
  return data;
}

/*
 * Create a charge in Unconfirmed, with the history row for its creation. Used by
 * the admin test tool today and by the Triggering project later: billing only
 * provides the fields, the rules for when and for whom come from that project.
 */
// A commission rate in percent (0 < rate <= 100), or null.
function validRate(v) {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

export async function createCharge(db, input) {
  const amount = input.amountCents;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new BillingError("bad_amount", "The amount must be a positive number of cents.");
  }
  const triggerType = String(input.triggerType ?? "").trim();
  if (!triggerType) throw new BillingError("bad_trigger", "A trigger type is required.");

  const { data: landlord, error: userError } = await db
    .from("users")
    .select("id, deleted_at, roles!role_id(name)")
    .eq("id", input.landlordId)
    .maybeSingle();
  if (userError) throw userError;
  if (!landlord || landlord.deleted_at || landlord.roles?.name !== "landlord") {
    throw new BillingError("bad_landlord", "Charges can only be assigned to a landlord account.");
  }

  const createdByType = input.createdByType === "admin" ? "admin" : "system";
  const createdById = createdByType === "admin" ? input.createdById : null;
  if (createdByType === "admin" && !createdById) {
    throw new BillingError("bad_actor", "An admin charge needs the admin who created it.");
  }

  // The agreement covering the property, recorded on the charge with its rate
  // unless the caller gave one.
  const covering = input.listingId ? await coveringAgreement(db, input.landlordId, input.listingId) : null;
  // Who is invoiced (Wyatt, 2026-11-25): the listing's authorized payer, else the
  // account's, once they accepted; else whoever holds the covering agreement.
  // Decided now and kept: a later change of payer never moves this charge.
  const payerLink = linkForListing(await payerRoleLinksFor(db, input.landlordId), input.listingId ?? null);
  const invoicedTo = payerLink?.payer_id ?? covering?.holderId ?? input.landlordId;

  const { data: charge, error } = await db
    .from("charges")
    .insert({
      landlord_id: input.landlordId,
      amount_cents: amount,
      description: input.description?.trim() || null,
      trigger_type: triggerType,
      trigger_ref: input.triggerRef ?? null,
      listing_id: input.listingId ?? null,
      lease_id: input.leaseId ?? null,
      student_id: input.studentId ?? null,
      created_by_type: createdByType,
      created_by_id: createdById,
      is_test: !!input.isTest,
      // The commission basis, when whatever creates the charge knows it (never guessed here).
      signed_rent_cents: Number.isInteger(input.signedRentCents) && input.signedRentCents >= 0 ? input.signedRentCents : null,
      commission_rate_percent: validRate(input.commissionRatePercent) ?? validRate(covering?.commissionRatePercent),
      covered_by_agreement_id: covering?.agreementId ?? null,
      covered_by_amendment_id: covering?.amendmentId ?? null,
      // Invoiced to someone other than the landlord: their authorized payer or signer.
      ...(invoicedTo !== input.landlordId && { payer_id: invoicedTo }),
    })
    .select("*")
    .single();
  if (error) throw error;

  const { error: historyError } = await db.from("charge_status_history").insert({
    charge_id: charge.id,
    from_status: null,
    to_status: "unconfirmed",
    actor_type: createdByType,
    actor_user_id: createdById,
    note: input.isTest ? "Created by the test charge tool" : null,
  });
  if (historyError) throw historyError;
  return charge;
}

export async function listChargesForLandlord(db, landlordId, now = new Date()) {
  const { data, error } = await db
    .from("charges")
    .select(LANDLORD_COLUMNS)
    .eq("landlord_id", landlordId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const by = await contestedBy(db, data.filter((r) => r.status === "contested").map((r) => r.id));
  // `contestedByOther`: the reason shown is the authorized payer's, not the landlord's own.
  return data.map((row) => ({ ...chargeView(row, now), ...(by.has(row.id) && by.get(row.id) !== landlordId && { contestedByOther: "payer" }) }));
}

/*
 * Who contested each of these charges (the landlord, or the authorized payer it
 * is billed to): a Map chargeId -> user id, from the history row of the move to
 * Contested. A charge with no such row (or no actor on it) is absent.
 */
export async function contestedBy(db, chargeIds) {
  const out = new Map();
  const ids = [...new Set((chargeIds ?? []).filter(Boolean))];
  if (!ids.length) return out;
  const { data, error } = await db
    .from("charge_status_history")
    .select("charge_id, actor_user_id, created_at")
    .in("charge_id", ids)
    .eq("to_status", "contested")
    .order("created_at", { ascending: true });
  if (error) {
    // Only a label depends on this: never fail the list for it.
    console.error("billing: could not read who contested", error.message);
    return out;
  }
  // The latest contest wins (a charge is contested once, but read defensively).
  for (const h of data ?? []) if (h.actor_user_id) out.set(h.charge_id, h.actor_user_id);
  return out;
}

/*
 * Charges on the landlord accounts this payer pays for (charges.payer_id,
 * Project B), newest first, each with the account it came from. Read only for an
 * authorized signer: the landlord approves or contests them. An authorized payer
 * (Wyatt, 2026-11-25) can approve or dispute them too, alongside the landlord.
 */
export async function listChargesPaidBy(db, payerId, now = new Date()) {
  const { data, error } = await db
    .from("charges")
    .select(`${LANDLORD_COLUMNS}, account:users!landlord_id(name, company_name, email)`)
    .eq("payer_id", payerId)
    .neq("landlord_id", payerId)
    .order("created_at", { ascending: false });
  if (error) {
    if (["42703", "PGRST200"].includes(error.code)) return [];
    throw error;
  }
  // Approve and Dispute are per charge (Wyatt, 2026-11-25): only for a charge
  // whose listing they are the accepted payer of now. One billed to them as the
  // signer, or from before they were removed as payer, is read only.
  const accounts = [...new Set(data.map((r) => r.landlord_id))];
  const linksOf = new Map(await Promise.all(accounts.map(async (id) => [id, await payerRoleLinksFor(db, id)])));
  const by = await contestedBy(db, data.filter((r) => r.status === "contested").map((r) => r.id));
  return data.map((row) => {
    const view = chargeView(row, now);
    const mayAct = paysFor(linksOf.get(row.landlord_id), payerId, row.listing_id);
    return {
      ...view,
      // They are still invoiced for it, so they are told how to dispute it.
      ...(!mayAct && { actions: { approve: false, contest: false, contactForDispute: !["voided", "contested"].includes(row.status) } }),
      ...(by.has(row.id) && by.get(row.id) !== payerId && { contestedByOther: "landlord" }),
      accountName: row.account?.company_name?.trim() || row.account?.name || row.account?.email || "Landlord account",
    };
  });
}

// Whether `userId` is the accepted payer for this listing of the account
// (`listingId` null: a charge on no listing, which the account's payer pays).
const paysFor = (payers, userId, listingId) => !!payers && linkForListing(payers, listingId ?? null)?.payer_id === userId;

// Whether this user may approve or dispute the charge: its landlord, or the
// authorized payer it is billed to, while they are still the payer for that
// charge's listing (not merely for something else on the account).
async function mayActOn(db, userId, row) {
  if (!row) return false;
  if (row.landlord_id === userId) return true;
  if (row.payer_id !== userId) return false;
  return paysFor(await payerRoleLinksFor(db, row.landlord_id), userId, row.listing_id);
}

async function ownedCharge(db, userId, chargeId) {
  const { data, error } = await db
    .from("charges")
    .select("id, landlord_id, payer_id, status, amount_cents, trigger_type, listing_id, lease_id, student_id")
    .eq("id", chargeId)
    .maybeSingle();
  if (error) throw error;
  if (!(await mayActOn(db, userId, data))) throw new BillingError("not_found", "Charge not found.", 404);
  return { ...data, byPayer: data.landlord_id !== userId };
}

// The landlord confirms a charge themselves. From Unconfirmed or Pending; it
// skips whatever is left of the review period.
export async function landlordApprove(db, { userId, chargeId }) {
  const charge = await ownedCharge(db, userId, chargeId);
  if (!["unconfirmed", "pending"].includes(charge.status)) {
    throw new BillingError("not_allowed", "Only a charge that is still in review can be approved.", 409);
  }
  return transitionCharge(db, {
    chargeId,
    expectedFrom: charge.status,
    to: "approved",
    actorType: "landlord",
    actorUserId: userId,
    ...(charge.byPayer && { note: "Approved by the authorized payer" }),
  });
}

// The landlord contests an Unconfirmed or Pending charge, for the full amount.
// Approved and Paid charges cannot be contested in the app.
export async function landlordContest(db, { userId, chargeId, reason }) {
  const text = String(reason ?? "").trim();
  if (!text) throw new BillingError("note_required", "Please tell us why you are contesting this charge.");
  if (text.length > MAX_REASON_LENGTH) {
    throw new BillingError("reason_too_long", `Please keep your reason under ${MAX_REASON_LENGTH} characters.`);
  }
  const charge = await ownedCharge(db, userId, chargeId);
  if (!canTransition(charge.status, "contested") || !["unconfirmed", "pending"].includes(charge.status)) {
    throw new BillingError(
      "not_allowed",
      "Only a charge that is still in review can be contested here. For anything else, please contact the team.",
      409
    );
  }
  const updated = await transitionCharge(db, {
    chargeId,
    expectedFrom: charge.status,
    to: "contested",
    actorType: "landlord",
    actorUserId: userId,
    note: text,
  });
  // `byPayer`: the authorized payer contested it, on the account `landlordId`.
  return { charge: updated, reason: text, byPayer: charge.byPayer, landlordId: charge.landlord_id };
}

// One charge as the landlord sees it (used to build the emails about it).
export async function getChargeViewForLandlord(db, userId, chargeId, now = new Date()) {
  const { data, error } = await db
    .from("charges")
    .select(LANDLORD_COLUMNS)
    .eq("id", chargeId)
    .maybeSingle();
  if (error) throw error;
  if (!(await mayActOn(db, userId, data))) throw new BillingError("not_found", "Charge not found.", 404);
  return chargeView(data, now);
}
