export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { adminConfirmCharge } from "@/lib/billing/adminReview";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * An admin confirms an Unconfirmed charge: it moves to Pending, the landlord's
 * 7 day review starts, and the action is recorded in the charge's history with
 * the admin as the actor.
 *
 * @auth admin
 */
export async function POST(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Charge not found.", 404);
    const charge = await adminConfirmCharge(supabase, { chargeId: id, adminId: session.user.id });
    return NextResponse.json({ ok: true, status: charge.status });
  } catch (err) {
    return billingErrorResponse(err, "confirm charge");
  }
}
