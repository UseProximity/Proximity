/*
 * The landlord's own address for the agreement's optional "Address" box: the
 * billing address on their Stripe account (decided 2026-11-04). Landlords add a
 * payment method before they sign, so it is normally there. Read from Stripe on
 * demand, never stored by us. Null when there is none; the box is then left for
 * the landlord to fill in Documenso.
 */
import { getStripe } from "./stripe.js";

export function formatStripeAddress(a) {
  if (!a) return null;
  const line = [a.line1, a.line2].filter(Boolean).join(" ");
  const cityLine = [a.city, [a.state, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const out = [line, cityLine].filter(Boolean).join(", ");
  return out || null;
}

// The same address in the signing form's parts: { street: "8151 Clayton Rd",
// suite: "Suite 301", city: "St. Louis, MO 63117" }.
export function splitStripeAddress(a) {
  if (!a) return null;
  const street = String(a.line1 ?? "").trim();
  const suite = String(a.line2 ?? "").trim();
  const city = [a.city, [a.state, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ").trim();
  return street || city ? { street, suite, city } : null;
}

// The Stripe address object behind the landlord's billing address, or null.
async function stripeAddressOf(db, userId) {
  const { data: account, error } = await db.from("billing_accounts").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!account?.stripe_customer_id) return null;
  const customer = await getStripe().customers.retrieve(account.stripe_customer_id, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (!customer || customer.deleted) return null;
  return customer.invoice_settings?.default_payment_method?.billing_details?.address?.line1
    ? customer.invoice_settings.default_payment_method.billing_details.address
    : customer.address ?? null;
}

// Two lines for the signing form's address fields (and the "Address 1/2" boxes).
export async function stripeBillingAddressLines(db, userId) {
  return splitStripeAddress(await stripeAddressOf(db, userId));
}

export async function stripeBillingAddress(db, userId) {
  const { data: account, error } = await db.from("billing_accounts").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!account?.stripe_customer_id) return null;
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(account.stripe_customer_id, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (!customer || customer.deleted) return null;
  return (
    formatStripeAddress(customer.invoice_settings?.default_payment_method?.billing_details?.address) ??
    formatStripeAddress(customer.address)
  );
}
