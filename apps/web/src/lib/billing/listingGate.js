/*
 * The listing gate: before a landlord puts a new listing, unit or offering in
 * front of students they need an Active payment method and, when that
 * requirement is on, a Signed commission agreement. Landlords may skip both when
 * they create an account; this is where it bites.
 *
 * Scope (the PRD's open question, answered with its recommendation):
 *   - it blocks PUBLISHING: a new listing, a new unit or offering, and putting
 *     back a published one. Saving a draft is never blocked, so nothing a
 *     landlord has typed is lost.
 *   - it applies to users with the landlord role. Admins, students (who may
 *     sublet), and the importer and PMS sync paths (which never call it) are exempt.
 *
 * Both requirements are switches in billing_settings and default OFF, so the code
 * can ship before landlords have been told and given time to enrol; an admin turns
 * them on at launch (Admin > Billing > Agreements):
 *
 *   payment_method_required   an Active payment method is needed to publish
 *   agreement_required        a Signed agreement is needed to publish
 *
 * Separately, a lease the overdue job withdrew cannot be put back by the landlord
 * (isLeaseHeldForBilling): an admin restores it once the invoice is settled.
 *
 * `db` is a service-role Supabase client, passed in so this stays testable.
 */
import { getBillingSetting } from "./settings.js";
import { getLiveAgreement } from "./agreements.js";
import { hasActivePaymentMethod } from "./paymentMethodState.js";

export const PAYMENT_METHOD_REQUIRED = "payment_method_required";
export const AGREEMENT_REQUIRED = "agreement_required";

// The pure rule. `missing` lists what stands in the way: "payment_method", "agreement".
export function gateDecision({ role, requirePaymentMethod, requireAgreement, hasPaymentMethod, agreementSigned }) {
  if (role !== "landlord") return { applies: false, allowed: true, missing: [] };
  const missing = [];
  if (requirePaymentMethod && !hasPaymentMethod) missing.push("payment_method");
  if (requireAgreement && !agreementSigned) missing.push("agreement");
  return { applies: true, allowed: missing.length === 0, missing };
}

const PARTS = {
  payment_method: "add an active payment method",
  agreement: "sign the commission agreement",
};

// What to tell a landlord who is blocked. Plain words, and where to fix it.
export function gateMessage(missing) {
  const parts = missing.map((m) => PARTS[m]).filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `Before you can publish a listing you need to ${list}. You can do this under Payments in your landlord dashboard. Your drafts are saved.`;
}

// The body a route returns when the gate says no.
export function gateResponseBody(gate) {
  return { error: gateMessage(gate.missing), code: "billing_setup_required", missing: gate.missing };
}

async function roleOf(db, userId) {
  const { data, error } = await db
    .from("users")
    .select("deleted_at, roles!role_id(name)")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data && !data.deleted_at ? data.roles?.name ?? null : null;
}

export async function getGateSettings(db) {
  const [requirePaymentMethod, requireAgreement] = await Promise.all([
    getBillingSetting(db, PAYMENT_METHOD_REQUIRED, false),
    getBillingSetting(db, AGREEMENT_REQUIRED, false),
  ]);
  return { requirePaymentMethod: requirePaymentMethod === true, requireAgreement: requireAgreement === true };
}

/*
 * Whether this user may publish right now, and the facts the dashboard shows.
 * Only landlords are ever checked; for anyone else it answers without touching
 * the settings or payment tables.
 */
export async function checkListingGate(db, userId, now = new Date()) {
  const role = await roleOf(db, userId);
  if (role !== "landlord") return { ...gateDecision({ role }), requirePaymentMethod: false, requireAgreement: false };

  const settings = await getGateSettings(db);
  let hasPaymentMethod = true;
  if (settings.requirePaymentMethod) {
    const { data, error } = await db
      .from("payment_methods")
      .select("status, type, exp_month, exp_year, deleted_at")
      .eq("user_id", userId)
      .is("deleted_at", null);
    if (error) throw error;
    hasPaymentMethod = hasActivePaymentMethod(data, now);
  }
  let agreementSigned = true;
  if (settings.requireAgreement) agreementSigned = (await getLiveAgreement(db, userId))?.status === "signed";

  return {
    ...gateDecision({ role, ...settings, hasPaymentMethod, agreementSigned }),
    ...settings,
  };
}

/*
 * True while the overdue job's withdrawal of this lease has not been restored by
 * an admin. A landlord cannot republish such a lease, or the withdrawal would be
 * pointless. Reads as false until the withdrawals table exists.
 */
export async function isLeaseHeldForBilling(db, leaseId) {
  const { data, error } = await db
    .from("billing_lease_withdrawals")
    .select("id")
    .eq("lease_id", leaseId)
    .is("restored_at", null)
    .limit(1);
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return false;
    throw error;
  }
  return data.length > 0;
}

export const HELD_FOR_BILLING_MESSAGE =
  "This listing was withdrawn because an invoice is overdue. Pay the invoice under Payments and we will put it back.";
