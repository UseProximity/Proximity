export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { runOverdueJob } from "@/lib/billing/overdueJob";
import { runMethodAttentionJob } from "@/lib/billing/methodAttentionJob";
import { enforceEnrollmentDeadline } from "@/lib/billing/enrollment";
import { billingNotify } from "@/lib/billing/billingNotify";
import { sendChangeRequestReminders } from "@/lib/billing/changeRequests";
import { changeRequestNotify } from "@/lib/billing/changeRequestNotify";
import { runAutopayJob } from "@/lib/billing/autopay";
import { getStripe } from "@/lib/billing/stripe";

/*
 * Daily cron: an invoice still unpaid more than 30 days after its due date
 * withdraws the landlord's leases (hidden from students), and the landlord and
 * the team are emailed. It counts from invoice due dates only, so Approved charges
 * under the $5 minimum never trigger it, and a payment still settling is not
 * overdue. An admin restores the leases once the invoice is paid. Safe to run
 * repeatedly: an invoice is actioned once.
 *
 * It also emails landlords whose default payment method is expiring this month,
 * has expired or has failed, and who have no other usable one, once per problem
 * (methodAttentionJob.js), so they can fix it before the monthly run.
 *
 * And on the enrollment deadline it switches the listing requirements on
 * (enforceEnrollmentDeadline), once.
 *
 * And it reminds the team about agreement change requests left unanswered for 5
 * days (changeRequests.sendChangeRequestReminders), at most once every 5 days each.
 * And it charges invoices whose autopay date has come, for landlords who turned
 * autopay on (autopay.js), and switches off autopay whose method was removed or
 * has expired. Each invoice is claimed before Stripe is called, so a second run
 * the same day charges nothing twice.
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
    const notify = billingNotify();
    const result = await runOverdueJob(supabase, { notify });
    if (result.failed.length) console.error("billing overdue job: some invoices failed", result.failed);
    // Separate from the overdue result, and its failure must not hide that result.
    let methods;
    try {
      methods = await runMethodAttentionJob(supabase, { notify });
      if (methods.failed.length) console.error("billing method check: some methods failed", methods.failed);
    } catch (err) {
      console.error("billing method check failed", err);
      methods = { error: "failed" };
    }
    let autopay;
    try {
      autopay = await runAutopayJob(supabase, getStripe(), { notify });
      if (autopay.errors.length) console.error("billing autopay: some invoices failed", autopay.errors);
    } catch (err) {
      console.error("billing autopay job failed", err);
      autopay = { error: "failed" };
    }
    let enrollment = null;
    try {
      enrollment = await enforceEnrollmentDeadline(supabase);
      if (enrollment) console.warn(`billing: enrollment deadline ${enrollment.deadline} reached, switched on ${enrollment.switchedOn.join(", ")}`);
    } catch (err) {
      console.error("billing enrollment deadline check failed", err);
      enrollment = { error: "failed" };
    }
    let changeRequests = null;
    try {
      changeRequests = await sendChangeRequestReminders(supabase, { notify: changeRequestNotify() });
    } catch (err) {
      console.error("billing change request reminders failed", err);
      changeRequests = { error: "failed" };
    }
    return NextResponse.json({ ok: true, ...result, methods, autopay, enrollment, changeRequests });
  } catch (err) {
    console.error("billing overdue job failed", err);
    return NextResponse.json({ error: "Overdue job failed" }, { status: 500 });
  }
}
