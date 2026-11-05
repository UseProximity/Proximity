export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { landlordApprove } from "@/lib/billing/charges";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * The landlord approves a charge that is Unconfirmed or Pending. Their approval
 * is the confirmation, so it skips any review time left; the charge is then
 * collected on the next monthly billing run.
 *
 * @auth landlord (own charges only)
 */
export async function POST(_req, { params }) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Charge not found.", 404);
    const charge = await landlordApprove(supabase, { userId: session.user.id, chargeId: id });
    return NextResponse.json({ ok: true, status: charge.status });
  } catch (err) {
    return billingErrorResponse(err, "approve charge");
  }
}
