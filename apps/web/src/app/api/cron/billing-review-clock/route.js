export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { runReviewClock } from "@/lib/billing/reviewClock";
import { finishStaleTakeovers, settleStalePayerDocuments } from "@/lib/billing/payerServices";
import { agreementServices } from "@/lib/billing/agreementServices";

/*
 * Daily cron: approve every Pending charge whose 7 day review has ended. The
 * 7 days count from when the charge entered Pending. A charge the landlord or an
 * admin already acted on is skipped, not overwritten. Safe to run repeatedly.
 *
 * Also the safety net for authorized signers: a signature whose follow-up never
 * finished (listings still waiting on a signed document) is settled now, and the
 * landlord emailed what was approved or declined. A landlord who signed their own
 * agreement to take over from their signer, but whose signer is still linked
 * (the follow-up after signing failed), has the takeover finished now.
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
    const result = await runReviewClock(supabase);
    if (result.failed.length) console.error("billing review clock: some charges failed", result.failed);
    let payerDocuments = null;
    try {
      payerDocuments = await settleStalePayerDocuments();
    } catch (err) {
      console.error("billing: settling payer documents failed", err?.message);
    }
    let takeovers = null;
    try {
      takeovers = await finishStaleTakeovers(agreementServices().documenso);
    } catch (err) {
      console.error("billing: finishing takeovers failed", err?.message);
    }
    return NextResponse.json({ ok: true, ...result, payerDocuments, takeovers });
  } catch (err) {
    console.error("billing review clock failed", err);
    return NextResponse.json({ error: "Review clock failed" }, { status: 500 });
  }
}
