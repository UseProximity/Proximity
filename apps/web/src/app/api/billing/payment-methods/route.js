export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { listPaymentMethods } from "@/lib/billing/paymentMethods";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The signed-in landlord's payment methods, with display fields and status only
 * (never a Stripe id). The payments portal is for landlord-role users only.
 *
 * @auth landlord
 */
export async function GET() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const methods = await listPaymentMethods(supabase, session.user.id);
    return NextResponse.json({ methods });
  } catch (err) {
    return billingErrorResponse(err, "list payment methods");
  }
}
