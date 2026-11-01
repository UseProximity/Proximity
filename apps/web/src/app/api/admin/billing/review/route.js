export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
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
export async function GET() {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const review = await loadAdminReview(supabase);
    return NextResponse.json({ ...review, testToolEnabled: !isProdData() });
  } catch (err) {
    return billingErrorResponse(err, "load admin review");
  }
}
