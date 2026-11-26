export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { getStripe } from "@/lib/billing/stripe";
import { setDefaultPaymentMethod } from "@/lib/billing/paymentMethods";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * Make one of the landlord's active payment methods the one invoices are charged
 * to. A method still Verifying, Expired or Failed cannot be the default.
 *
 * @auth landlord (own methods only)
 */
export async function POST(_req, { params }) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Payment method not found.", 404);

    await setDefaultPaymentMethod(supabase, getStripe(), { userId: session.user.id, id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return billingErrorResponse(err, "set default payment method");
  }
}
