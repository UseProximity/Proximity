/*
 * GET /api/seo/opportunities — the current flag list as JSON, computed live
 * from Search Console. This is the contract the /seo-draft workflow consumes
 * when picking what to refresh. Same CRON_SECRET bearer as the crons; no
 * database writes ever happen here.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { gscConfigured, fetchGscWindows } from "@/lib/seo/gsc";
import { computeFlags } from "@/lib/seo/report";

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!gscConfigured()) {
    return NextResponse.json({ error: "GSC not configured" }, { status: 503 });
  }
  try {
    const windows = await fetchGscWindows();
    const flags = computeFlags(windows);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      windows: { current: windows.currentRange, previous: windows.previousRange },
      flags,
    });
  } catch (err) {
    console.error("[seo/opportunities] failed:", err);
    return NextResponse.json({ error: String(err.message ?? err) }, { status: 500 });
  }
}
