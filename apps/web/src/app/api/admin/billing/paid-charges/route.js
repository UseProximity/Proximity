export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { listPaidCharges } from "@/lib/billing/adjustments";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Recent Paid charges with how much has been refunded or credited on each, for
 * the admin's Corrections screen.
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;

  try {
    return NextResponse.json({ charges: await listPaidCharges(supabase) });
  } catch (err) {
    return billingErrorResponse(err, "list paid charges");
  }
}
