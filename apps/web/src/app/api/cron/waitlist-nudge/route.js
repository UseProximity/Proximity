/*
 * Every 5 minutes: chase waitlist leads whose Proximity account is still unusable.
 *
 * The listing's dialog shows a "finish your account" prompt the moment the
 * hand-off succeeds, so this is the safety net for the student who never saw it
 * (the tab was closed on the landlord's form, or the prompt was dismissed). A
 * lead is picked up once it is NUDGE_DELAY_MINUTES old, and each person is
 * mailed at most once ever.
 *
 * Runs on the same cadence as review-confirmations because the delay is enforced
 * in the query, not by the schedule. Off production, sendMailSafe redirects or
 * suppresses the mail, so this is safe to run against the dev snapshot.
 *
 * Protected by the same CRON_SECRET bearer token as the other crons.
 *
 * @auth cron
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/email";
import {
  NUDGE_DELAY_MINUTES,
  flushWaitlistNudge,
  waitlistLeadsAwaitingNudge,
} from "@/lib/waitlistNudge";

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = getBaseUrl(req);
  let sent = 0;
  let skipped = 0;
  const failures = [];

  try {
    const leads = await waitlistLeadsAwaitingNudge(NUDGE_DELAY_MINUTES);
    for (const lead of leads) {
      try {
        const result = await flushWaitlistNudge({ lead, baseUrl });
        if (result.sent) sent += 1;
        else skipped += 1;
      } catch (err) {
        // One bad address must not strand the rest of the batch.
        console.error("[cron waitlist-nudge] lead failed:", lead.user_id, err);
        failures.push(lead.user_id);
      }
    }
  } catch (err) {
    console.error("[cron waitlist-nudge] run failed:", err);
    return NextResponse.json({ error: "Run failed" }, { status: 500 });
  }

  return NextResponse.json({ sent, skipped, failures: failures.length });
}
