/*
 * Daily (9am St. Louis): the per-listing agents' rollout digest to the team,
 * and a note to each landlord whose website dropped a unit or listing.
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
    const dry = new URL(req.url).searchParams.get("dry") === "1";
    return NextResponse.json(await runDigest({ email: !dry }));
  } catch (err) {
    console.error("[agent-digest] failed:", err);
    return NextResponse.json({ error: "digest failed" }, { status: 500 });
  }
}
