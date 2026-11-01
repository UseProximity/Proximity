export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { runOverdueJob } from "@/lib/billing/overdueJob";
import { billingNotify } from "@/lib/billing/billingNotify";

/*
 * Daily cron: an invoice still unpaid more than 30 days after its invoice date
 * withdraws the landlord's leases (hidden from students), and the landlord and
 * the team are emailed. It counts from the invoice date only, so Approved charges
 * under the $5 minimum never trigger it, and a payment still settling is not
 * overdue. An admin restores the leases once the invoice is paid. Safe to run
 * repeatedly: an invoice is actioned once.
 *
 * Security: CRON_SECRET bearer token, same as the other cron routes.
 *
 * @auth cron
 */
export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runOverdueJob(supabase, { notify: billingNotify() });
    if (result.failed.length) console.error("billing overdue job: some invoices failed", result.failed);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("billing overdue job failed", err);
    return NextResponse.json({ error: "Overdue job failed" }, { status: 500 });
  }
}
