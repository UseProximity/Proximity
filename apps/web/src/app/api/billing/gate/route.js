export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { agreementView, getLiveAgreement } from "@/lib/billing/agreements";
import { checkListingGate, gateMessage } from "@/lib/billing/listingGate";
import { getEnrollmentWindow } from "@/lib/billing/enrollment";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * What the signed-in landlord needs before they can publish a listing, and where
 * they stand on it: which requirements are switched on, what is missing, and
 * their commission agreement's status. Drives the checklist on the Payments tab.
 *
 * @auth landlord
 */
export async function GET() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const [gate, agreement, enrollment] = await Promise.all([
      checkListingGate(supabase, session.user.id),
      getLiveAgreement(supabase, session.user.id),
      getEnrollmentWindow(supabase),
    ]);
    return NextResponse.json({
      allowed: gate.allowed,
      missing: gate.missing,
      message: gate.allowed ? null : gateMessage(gate.missing),
      requirePaymentMethod: gate.requirePaymentMethod,
      requireAgreement: gate.requireAgreement,
      agreement: agreementView(agreement),
      // The enrollment window, shown as a banner until the landlord has set up.
      enrollment: { deadline: enrollment.deadline, includeAgreement: enrollment.includeAgreement },
    });
  } catch (err) {
    return billingErrorResponse(err, "read listing gate");
  }
}
