export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { agreementView, getLiveAgreement } from "@/lib/billing/agreements";
import { checkListingGate, gateMessage } from "@/lib/billing/listingGate";
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
    const [gate, agreement] = await Promise.all([
      checkListingGate(supabase, session.user.id),
      getLiveAgreement(supabase, session.user.id),
    ]);
    return NextResponse.json({
      allowed: gate.allowed,
      missing: gate.missing,
      message: gate.allowed ? null : gateMessage(gate.missing),
      requirePaymentMethod: gate.requirePaymentMethod,
      requireAgreement: gate.requireAgreement,
      agreement: agreementView(agreement),
    });
  } catch (err) {
    return billingErrorResponse(err, "read listing gate");
  }
}
