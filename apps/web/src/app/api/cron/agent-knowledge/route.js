/*
 * Weekly (Monday, every hour from 5am to 3pm St. Louis): queue the
 * whole-site knowledge read for every listing with a website
 * (lib/agents/sync.js runWeeklyKnowledge). The later runs pick up listings
 * whose daily sync was still running at the earlier ones; a listing already
 * read this week is skipped. The import-jobs cron drains the queue. Does nothing while the
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
