/*
 * Daily (4am St. Louis): queue every due listing's sync as its own job. The
 * import-jobs cron drains the queue in lanes over the following minutes.
 * Does nothing while the agents' global switch is off.
 *
 * @auth cron
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { cronAuthorized } from "@/app/api/landlord/import/_auth";
import { runDailyBatch } from "@/lib/agents/sync";

export async function GET(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runDailyBatch());
  } catch (err) {
    console.error("[agent-sync] batch failed:", err);
    return NextResponse.json({ error: "batch failed" }, { status: 500 });
  }
}
