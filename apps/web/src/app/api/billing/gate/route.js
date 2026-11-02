export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { agreementState, agreementView, syncAgreement } from "@/lib/billing/agreements";
import { agreementServices } from "@/lib/billing/agreementServices";
import { checkListingGate, gateMessage } from "@/lib/billing/listingGate";
import { getEnrollmentWindow } from "@/lib/billing/enrollment";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * What the signed-in landlord needs before they can publish a listing, and where
 * they stand on it: which requirements are switched on, what is missing, and
 * their commission agreement's status. Drives the checklist on the Payments tab.
 *
 * A copy the landlord is part way through signing is checked with Documenso
 * first, so the page is right even if the webhook has not arrived.
 *
 * @auth landlord
 */
export async function GET() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { documenso, signingAvailable, options } = agreementServices();
    if (signingAvailable) await syncAgreement(supabase, documenso, session.user.id, options);
    const [gate, agreement, enrollment] = await Promise.all([
      checkListingGate(supabase, session.user.id),
      agreementState(supabase, session.user.id),
      getEnrollmentWindow(supabase),
    ]);
    return NextResponse.json({
      allowed: gate.allowed,
      missing: gate.missing,
      message: gate.allowed ? null : gateMessage(gate.missing),
      requirePaymentMethod: gate.requirePaymentMethod,
      requireAgreement: gate.requireAgreement,
      agreement: agreementView(agreement, { signingAvailable }),
      // The enrollment window, shown as a banner until the landlord has set up.
      enrollment: { deadline: enrollment.deadline, includeAgreement: enrollment.includeAgreement },
    });
  } catch (err) {
    return billingErrorResponse(err, "read listing gate");
  }
}
