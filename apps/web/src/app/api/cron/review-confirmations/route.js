/*
 * Every 5 minutes: send the batched confirmation to anyone who reviewed and
 * then walked away.
 *
 * The review flow flushes its own confirmation when a student leaves the loop
 * cleanly (/api/reviews/confirm). This is the safety net for everyone else —
 * the tab closed mid-flow, the profile step abandoned — and the only path that
 * fires for a student who never answered "leave another review?" at all.
 *
 * A reviewer is picked up once their OLDEST unconfirmed review is more than
 * CONFIRMATION_DELAY_MINUTES old, so someone still working through a second
 * review is left alone until they stop. flushReviewConfirmation claims rows
 * before mailing, so this racing an explicit flush yields one email.
 *
 * Protected by the same CRON_SECRET bearer token as the other crons.
 *
 * @auth cron
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/email";
import {
  CONFIRMATION_DELAY_MINUTES,
  flushReviewConfirmation,
  reviewersAwaitingConfirmation,
} from "@/lib/reviews/confirmation";

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
    const userIds = await reviewersAwaitingConfirmation(CONFIRMATION_DELAY_MINUTES);
    for (const userId of userIds) {
      try {
        const result = await flushReviewConfirmation({ userId, baseUrl });
        if (result.sent) sent += 1;
        else skipped += 1;
      } catch (err) {
        // One bad reviewer must not stop the sweep; the rows stay unclaimed
        // and the next run retries them.
        failures.push(err?.message || "unknown");
      }
    }
    return NextResponse.json({
      ok: true,
      considered: userIds.length,
      sent,
      skipped,
      failures: failures.length,
    });
  } catch (e) {
    console.error("GET /api/cron/review-confirmations failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
