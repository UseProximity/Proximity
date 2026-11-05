export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { getBaseUrl } from "@/lib/email";
import { getStripe } from "@/lib/billing/stripe";
import { getOrCreateBillingAccount } from "@/lib/billing/customers";
import { setupSessionParams } from "@/lib/billing/paymentMethods";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Start adding a payment method: creates the landlord's Stripe customer if they
 * have none yet, then a Stripe-hosted Checkout page in setup mode, and returns
 * its URL for the browser to open. Card and bank details are typed only there.
 * Body: { type: "us_bank_account" | "card" }
 *
 * @auth landlord
 */
export async function POST(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { type } = await req.json().catch(() => ({}));
    const user = { id: session.user.id, email: session.user.email, name: session.user.name };

    const stripe = getStripe();
    const account = await getOrCreateBillingAccount(supabase, stripe, user);
    const params = setupSessionParams({
      customerId: account.stripe_customer_id,
      userId: user.id,
      type,
      baseUrl: getBaseUrl(),
    });
    const checkout = await stripe.checkout.sessions.create(params);
    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    return billingErrorResponse(err, "start payment method setup");
  }
}
