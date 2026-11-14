/*
 * Weekly (Monday 5am and 6am St. Louis): queue the whole-site knowledge read
 * for every listing with a website (lib/agents/sync.js runWeeklyKnowledge).
 * The second run picks up listings whose daily sync was still running at the
 * first. The import-jobs cron drains the queue. Does nothing while the
 * agents' global switch is off.
 *
 * @auth cron
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { cronAuthorized } from "@/app/api/landlord/import/_auth";
import { runWeeklyKnowledge } from "@/lib/agents/sync";

export async function GET(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runWeeklyKnowledge());
  } catch (err) {
    console.error("[agent-knowledge] batch failed:", err);
    return NextResponse.json({ error: "batch failed" }, { status: 500 });
  }
}
