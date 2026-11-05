export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { listChargesForLandlord } from "@/lib/billing/charges";
import { summarizeBalance } from "@/lib/billing/chargeLifecycle";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The signed-in landlord's charges, newest first, with what the next billing run
 * will collect (balanceCents) and what is still under review (inReviewCents).
 * Each charge says which actions the landlord may take on it. The admin's
 * internal notes are never included.
 *
 * @auth landlord (own charges only)
 */
export async function GET() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const charges = await listChargesForLandlord(supabase, session.user.id);
    const summary = summarizeBalance(
      charges.map((c) => ({ status: c.status, amount_cents: c.amountCents }))
    );
    return NextResponse.json({ charges, summary });
  } catch (err) {
    return billingErrorResponse(err, "list charges");
  }
}
