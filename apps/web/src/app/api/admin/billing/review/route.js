export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { isProdData } from "@/lib/appEnv";
import { requireDbRole } from "@/lib/userRole";
import { loadAdminReview } from "@/lib/billing/adminReview";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The admin billing review: Unconfirmed charges waiting to be confirmed,
 * Contested charges waiting to be resolved, chargebacks, and failed or overdue
 * invoices. `testToolEnabled` says whether the test charge tool may be used here
 * (never on production).
 *
 * Always reads this environment's own database. The dashboard's dev/prod switch
 * is deliberately ignored: billing rows sit beside Stripe ids that only match
 * this environment's Stripe keys.
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;

  try {
    const review = await loadAdminReview(supabase);
    return NextResponse.json({
      ...review,
      testToolEnabled: !isProdData() && billingDb.writable,
      // Which database this is, and whether this site may change it (lib/billing/adminDb.js).
      env: { target: billingDb.target, own: billingDb.own, writable: billingDb.writable },
    });
  } catch (err) {
    return billingErrorResponse(err, "load admin review");
  }
}
