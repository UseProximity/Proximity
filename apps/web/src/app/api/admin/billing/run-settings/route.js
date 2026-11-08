export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { billingPeriodFor, isBillingDay, nextBillingDay } from "@/lib/billing/billingPeriod";
import { BILLING_RUN_ENABLED, getBillingSetting, setBillingSetting } from "@/lib/billing/settings";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

async function status(supabase) {
  const now = new Date();
  return {
    enabled: (await getBillingSetting(supabase, BILLING_RUN_ENABLED, false)) === true,
    billingPeriod: billingPeriodFor(now),
    isBillingDay: isBillingDay(now),
    nextBillingDay: nextBillingDay(now),
  };
}

/*
 * Whether the monthly cron may create real invoices (billing_run_enabled, off by
 * default). GET reads it with the billing calendar; PUT { enabled: boolean }
 * changes it. It should be switched on only after a dry run has been checked.
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;
  try {
    return NextResponse.json(await status(supabase));
  } catch (err) {
    return billingErrorResponse(err, "read billing run settings");
  }
}

export async function PUT(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;
  try {
    const { enabled } = await req.json().catch(() => ({}));
    if (typeof enabled !== "boolean") throw new BillingError("bad_value", "enabled must be true or false.");
    await setBillingSetting(supabase, BILLING_RUN_ENABLED, enabled, session.user.id);
    return NextResponse.json(await status(supabase));
  } catch (err) {
    return billingErrorResponse(err, "change billing run settings");
  }
}
