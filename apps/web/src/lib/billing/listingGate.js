/*
 * The listing gate: before a landlord puts a new listing, unit or offering in
 * front of students they need an Active payment method and, when that
 * requirement is on, a Signed marketing agreement. Landlords may skip both when
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
 *   agreement_required        every property being published must be covered by
 *                             the landlord's signed agreement (coverage.js): their
 *                             master's Exhibit A, or a signed amendment to it
 *
 * Coverage is per property (decisions of 2026-11-04). A route passes the
 * listings it is about to put live; any that are not covered come back in
 * `uncovered`, and the landlord signs the master or an amendment covering them
 * in the publish dialog, then publishes again. An unsigned document never
 * covers anything. Review sandbox accounts (App Store review) are exempt.
 *
 * A landlord whose invoice went overdue (the overdue job withdrew their leases and
 * it is still unpaid) is blocked from publishing anything new as well, always,
 * whatever the switches say: otherwise a new listing or offering would put them
 * straight back on the market. That clears as soon as the invoice is paid.
 *
 * Separately, a lease the overdue job withdrew cannot be put back by anyone but an
 * admin: the database refuses it (202611010002_billing_holds.sql), and
 * isLeaseHeldForBilling lets a route say so in plain words first.
 *
 * `db` is a service-role Supabase client, passed in so this stays testable.
 */
import { getBillingSetting } from "./settings.js";
import { agreementState, coverageFor } from "./agreements.js";
import { resolvePublishedIds, uncoveredAmong } from "./coverage.js";
import { hasActivePaymentMethod } from "./paymentMethodState.js";

export const PAYMENT_METHOD_REQUIRED = "payment_method_required";
export const AGREEMENT_REQUIRED = "agreement_required";

// The pure rule. `missing` lists what stands in the way: "payment_method", "agreement".
export function gateDecision({ role, requirePaymentMethod, requireAgreement, hasPaymentMethod, agreementSigned, overdueInvoice = false, sandbox = false }) {
  if (role !== "landlord" || sandbox) return { applies: false, allowed: true, missing: [] };
  const missing = [];
  if (overdueInvoice) missing.push("overdue_invoice");
  if (requirePaymentMethod && !hasPaymentMethod) missing.push("payment_method");
  if (requireAgreement && !agreementSigned) missing.push("agreement");
  return { applies: true, allowed: missing.length === 0, missing };
}

const PARTS = {
  overdue_invoice: "pay your overdue invoice",
  payment_method: "add an active payment method",
  agreement: "sign the marketing agreement",
};

// What to tell a landlord who is blocked. Plain words, and where to fix it.
export function gateMessage(missing, uncovered = []) {
  const named = uncovered.filter((u) => u.listingId).map((u) => u.address);
  const parts = missing
    .map((m) =>
      m === "agreement" && uncovered.length
        ? named.length
          ? `add ${named.length === 1 ? named[0] : `${named.length} properties`} to your marketing agreement`
          : "add this property to your marketing agreement"
        : PARTS[m]
    )
    .filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `Before you can publish a listing you need to ${list}. You can do this under Billing in your landlord dashboard. Your drafts are saved.`;
}

// The body a route returns when the gate says no. `uncovered` lets the page open
// the signing dialog for exactly those properties.
export function gateResponseBody(gate) {
  return {
    error: gateMessage(gate.missing, gate.uncovered ?? []),
    code: "billing_setup_required",
    missing: gate.missing,
    uncovered: gate.uncovered ?? [],
  };
}

async function userOf(db, userId) {
  const { data, error } = await db
    .from("users")
    .select("deleted_at, review_sandbox, roles!role_id(name)")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.deleted_at) return { role: null, sandbox: false };
  return { role: data.roles?.name ?? null, sandbox: data.review_sandbox === true };
}

/*
 * Whether the landlord has an invoice the overdue job actioned that is still
 * unpaid. Reads as no until the billing tables exist, so listing keeps working in
 * an environment that does not have them yet.
 */
export async function hasOverdueInvoice(db, userId) {
  const { data, error } = await db
    .from("billing_invoices")
    .select("id")
    .eq("landlord_id", userId)
    .not("overdue_actioned_at", "is", null)
    .in("status", ["open", "failed"])
    .limit(1);
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return false;
    throw error;
  }
  return data.length > 0;
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
 * Only landlords are ever checked; for anyone else (and review sandbox accounts)
 * it answers without touching the settings or payment tables.
 *
 *   listingIds   the properties about to go live. With the agreement required,
 *                each must be covered; the ones that are not come back in
 *                `uncovered` ({ listingId, address }).
 *   newProperty  a property that does not exist yet (add listing): never covered
 *   neither      the dashboard's question: does the landlord's master count?
 */
export async function checkListingGate(db, userId, { listingIds = null, newProperty = false, now = new Date() } = {}) {
  const { role, sandbox } = await userOf(db, userId);
  if (role !== "landlord" || sandbox) {
    return { ...gateDecision({ role, sandbox }), requirePaymentMethod: false, requireAgreement: false, uncovered: [] };
  }

  const [settings, overdueInvoice] = await Promise.all([getGateSettings(db), hasOverdueInvoice(db, userId)]);
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
  let uncovered = [];
  if (settings.requireAgreement) {
    if (listingIds?.length || newProperty) {
      const ids = await resolvePublishedIds(db, listingIds ?? []);
      const { properties, covered } = await coverageFor(db, userId, now);
      uncovered = uncoveredAmong(properties, covered, ids);
      if (newProperty) uncovered.push({ listingId: null, address: "New property" });
      agreementSigned = uncovered.length === 0;
    } else {
      // Signed, in its term, and on a version that still counts.
      agreementSigned = (await agreementState(db, userId, now)).valid;
    }
  }

  return {
    ...gateDecision({ role, ...settings, hasPaymentMethod, agreementSigned, overdueInvoice }),
    ...settings,
    uncovered,
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
  "This listing was withdrawn because an invoice is overdue. Pay the invoice under Billing and we will put it back.";
