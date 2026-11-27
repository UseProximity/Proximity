/*
 * Weekly (Mondays, 9am St. Louis; the cron fires daily and this route sends
 * on Mondays): the per-listing agents' digest to the team for the last seven
 * days, and a note to each landlord whose website dropped a unit or listing.
 * ?dry=1 builds it without sending. Does nothing while the agents' global
 * switch is off.
 *
 * @auth cron
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { cronAuthorized } from "@/app/api/landlord/import/_auth";
import { agentsEnabled } from "@/lib/agents/flags";
import { runDigest } from "@/lib/agents/digest";

export async function GET(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!agentsEnabled()) return NextResponse.json({ skipped: "agents off" });
  try {
    const q = new URL(req.url).searchParams;
    const dry = q.get("dry") === "1";
    /*
     * One email a week (Wyatt, 2026-11-24): Mondays, covering seven days.
     * The admin Agents page is the live view on every other day. ?force=1
     * sends today's anyway; ?dry=1 builds without sending.
     */
    const monday = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long" }) === "Monday";
    if (!monday && !dry && q.get("force") !== "1") return NextResponse.json({ skipped: "weekly: the digest goes out on Mondays" });
    return NextResponse.json(await runDigest({ email: !dry, days: 7 }));
  } catch (err) {
    console.error("[agent-digest] failed:", err);
    return NextResponse.json({ error: "digest failed" }, { status: 500 });
  }
}
