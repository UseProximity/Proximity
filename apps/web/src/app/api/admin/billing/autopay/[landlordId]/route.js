export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { autopayState, disableAutopay } from "@/lib/billing/autopay";
import { billingNotify } from "@/lib/billing/billingNotify";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * A landlord's autopay, for admins.
 *   GET     whether it is on and with which method
 *   DELETE  turns it off (for example at the landlord's request by email); the
 *           landlord is emailed that it is off. Admins can never turn it on.
 *
 * @auth admin
 */
async function landlordIdFrom(params) {
  const { landlordId } = await params;
  if (!isUuid(landlordId)) throw new BillingError("not_found", "Landlord not found.", 404);
  return landlordId;
}

export async function GET(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;
  try {
    const state = await autopayState(supabase, await landlordIdFrom(params));
    // Admins see the state, not the choices or the consent wording.
    return NextResponse.json({ enabled: state.enabled, method: state.method, authorizedAt: state.authorizedAt, consecutiveFailures: state.consecutiveFailures });
  } catch (err) {
    return billingErrorResponse(err, "read landlord autopay");
  }
}

export async function DELETE(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;
  try {
    const result = await disableAutopay(supabase, {
      userId: await landlordIdFrom(params),
      reason: "admin",
      byId: session.user.id,
      notify: billingNotify(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return billingErrorResponse(err, "turn off landlord autopay");
  }
}
