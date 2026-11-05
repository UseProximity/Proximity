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
