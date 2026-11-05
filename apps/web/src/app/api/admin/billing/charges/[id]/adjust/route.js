export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { getStripe } from "@/lib/billing/stripe";
import { adjustPaidCharge } from "@/lib/billing/adjustments";
import { dollarsToCents } from "@/lib/billing/money";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * Correct a Paid charge: a Stripe refund to the landlord's payment method (the
 * default) or a credit on their next invoice. The charge itself is never edited;
 * the correction is recorded against it, and the adjustments never add up to more
 * than the charge.
 * Body: { kind: "refund" | "credit", amount (dollars, "25.00"), reason }
 *
 * @auth admin
 */
export async function POST(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Charge not found.", 404);
    const body = await req.json().catch(() => ({}));
    const amountCents = dollarsToCents(body.amount);
    if (!amountCents) throw new BillingError("bad_amount", "Enter an amount in dollars, like 25.00.");

    const adjustment = await adjustPaidCharge(supabase, getStripe(), {
      chargeId: id,
      adminId: session.user.id,
      kind: body.kind,
      amountCents,
      reason: body.reason,
    });
    return NextResponse.json({ ok: true, adjustment });
  } catch (err) {
    return billingErrorResponse(err, "adjust charge");
  }
}
