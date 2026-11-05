export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { getStripe } from "@/lib/billing/stripe";
import { runBillingRun } from "@/lib/billing/billingRun";
import { billingNotify } from "@/lib/billing/billingNotify";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Run the monthly billing by hand: a dry run (the default), which works out every
 * landlord's invoice and total and creates nothing, or a live run, which creates
 * the Stripe invoices and charges them. A live run needs { confirm: true }.
 *
 * Used for the dry run to check before the first real run, to run billing on
 * demand, and to finish a run that was cut short (it picks up where it stopped).
 * The invoice's month is the current month in America/Chicago, so a live run
 * mid-month bills that month and the cron's run on the first Monday then finds it
 * done.
 * Body: { dryRun?: boolean (default true), confirm?: boolean }
 *
 * @auth admin
 */
export async function POST(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false;
    if (!dryRun && body.confirm !== true) {
      throw new BillingError("confirm_required", "Confirm that you want to create real invoices.");
    }
    const result = await runBillingRun({
      db: supabase,
      stripe: getStripe(),
      dryRun,
      notify: billingNotify(),
    });
    return NextResponse.json(result);
  } catch (err) {
    return billingErrorResponse(err, "billing run");
  }
}
