export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { adminVoidCharge } from "@/lib/billing/adminReview";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * An admin voids a charge that is Unconfirmed, Pending or Approved, with a
 * written internal note. A Contested charge is resolved instead, and a charge
 * already on an invoice is refused (it also has to change the Stripe invoice).
 * Body: { note }
 *
 * @auth admin
 */
export async function POST(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Charge not found.", 404);
    const { note } = await req.json().catch(() => ({}));
    const charge = await adminVoidCharge(supabase, { chargeId: id, adminId: session.user.id, note });
    return NextResponse.json({ ok: true, status: charge.status });
  } catch (err) {
    return billingErrorResponse(err, "void charge");
  }
}
