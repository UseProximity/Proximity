export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getStripe } from "@/lib/billing/stripe";
import { isBillingDay } from "@/lib/billing/billingPeriod";
import { followUpBillingRun, runBillingRun } from "@/lib/billing/billingRun";
import { BILLING_RUN_ENABLED, getBillingSetting } from "@/lib/billing/settings";
import { billingNotify } from "@/lib/billing/billingNotify";

/*
 * Monthly billing run. Vercel crons are UTC and know nothing about months, so this
 * fires every day and bills on the first Monday of the month in America/Chicago.
 * Every other day, with billing on, it is a follow-up (review of 2026-11-07): it
 * continues a run that ran out of time this month, and finishes any invoice an
 * earlier run left unfinished or un-emailed. With nothing to do it returns at once.
 *
 * It creates real invoices only when the billing_run_enabled setting is on. Until
 * an admin has checked a dry run and switched it on (Admin > Billing > Billing
 * run), the cron computes a dry run and logs the totals, so the first live run
 * can never be a surprise. Safe to run again after a crash: see lib/billing/billingRun.js.
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

  const now = new Date();
  if (!isBillingDay(now)) {
    try {
      const enabled = (await getBillingSetting(supabase, BILLING_RUN_ENABLED, false)) === true;
      if (!enabled) return NextResponse.json({ ok: true, skipped: "not_billing_day" });
      const result = await followUpBillingRun({ db: supabase, stripe: getStripe(), now, notify: billingNotify() });
      if (!result) return NextResponse.json({ ok: true, skipped: "not_billing_day" });
      if (result.summary.errors) console.error("billing follow-up: some landlords failed", result.results.filter((r) => r.outcome === "error"));
      return NextResponse.json({ ok: true, followUp: true, summary: result.summary, unfinished: result.unfinished });
    } catch (err) {
      console.error("billing follow-up failed", err);
      return NextResponse.json({ error: "Billing follow-up failed" }, { status: 500 });
    }
  }

  try {
    const enabled = (await getBillingSetting(supabase, BILLING_RUN_ENABLED, false)) === true;
    const result = await runBillingRun({
      db: supabase,
      stripe: getStripe(),
      now,
      dryRun: !enabled,
      notify: billingNotify(),
    });

    if (!enabled) {
      console.warn(
        `billing run: automatic billing is OFF, dry run only (${result.newInvoiceCount} invoices, ${result.grandTotalCents} cents). Review it in Admin > Billing, then switch it on.`
      );
      return NextResponse.json({
        ok: true,
        skipped: "disabled",
        invoices: result.newInvoiceCount,
        grandTotalCents: result.grandTotalCents,
      });
    }
    if (result.summary.errors) console.error("billing run: some landlords failed", result.results.filter((r) => r.outcome === "error"));
    if (result.unfinished) console.error("billing run: out of time, the rest is billed by tomorrow's follow-up", result.summary);
    return NextResponse.json({ ok: true, summary: result.summary, unfinished: result.unfinished });
  } catch (err) {
    console.error("billing run failed", err);
    return NextResponse.json({ error: "Billing run failed" }, { status: 500 });
  }
}
