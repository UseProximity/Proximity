export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { getStripe } from "@/lib/billing/stripe";
import { removePaymentMethod } from "@/lib/billing/paymentMethods";
import { outstandingBalanceCents } from "@/lib/billing/balance";
import { sendMethodRemovedTeamEmail } from "@/lib/billing/billingEmails";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * Remove one of the landlord's payment methods: detached on Stripe and soft
 * deleted here. If it was the default, another active method takes over. If it
 * was their only one, the team is emailed with the landlord and their outstanding
 * balance; nothing else changes automatically.
 *
 * @auth landlord (own methods only)
 */
export async function DELETE(_req, { params }) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Payment method not found.", 404);

    const result = await removePaymentMethod(supabase, getStripe(), { userId: session.user.id, id });

    if (result.wasLast) {
      await sendMethodRemovedTeamEmail({
        landlordName: session.user.name,
        landlordEmail: session.user.email,
        outstandingCents: await outstandingBalanceCents(supabase, session.user.id),
      });
    }
    return NextResponse.json({ ok: true, remaining: result.remaining });
  } catch (err) {
    return billingErrorResponse(err, "remove payment method");
  }
}
