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
import { canTransition } from "./chargeLifecycle.js";
import { chargeView } from "./chargeDisplay.js";

const MAX_REASON_LENGTH = 2000;

// The landlord-facing columns. resolution_note is the admin's internal note and
// is never sent to a landlord.
const LANDLORD_COLUMNS = `
  id, landlord_id, amount_cents, description, trigger_type, status, created_at,
  pending_at, contest_reason,
  listing:listings!listing_id(title, address),
  lease:unit_leases!lease_id(lease_term_months, listing_units!unit_id(name, unit_designator, unit_number, bedrooms)),
  student:users!student_id(name)
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
  return data.map((row) => chargeView(row, now));
}

async function ownedCharge(db, userId, chargeId) {
  const { data, error } = await db
    .from("charges")
    .select("id, landlord_id, status, amount_cents, trigger_type, listing_id, lease_id, student_id")
    .eq("id", chargeId)
    .eq("landlord_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new BillingError("not_found", "Charge not found.", 404);
  return data;
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
  return { charge: updated, reason: text };
}

// One charge as the landlord sees it (used to build the emails about it).
export async function getChargeViewForLandlord(db, userId, chargeId, now = new Date()) {
  const { data, error } = await db
    .from("charges")
    .select(LANDLORD_COLUMNS)
    .eq("id", chargeId)
    .eq("landlord_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new BillingError("not_found", "Charge not found.", 404);
  return chargeView(data, now);
}
