export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { cronAuthorized } from "@/app/api/landlord/import/_auth";
import { runSourceSync } from "@/lib/sourceImport/sync";

/*
 * The recurring website sync. Each monitor carries its own interval, so this
 * can run daily and only the due ones are read.
 *
 * Not scheduled (Wyatt, 2026-10-26): the weekly entry was removed from
 * vercel.json so monitors created with auto_apply never change a live listing
 * before the per-listing agents ship. The listing agents project replaces it
 * with a daily batch of per-agent syncs behind a switch. Until then it runs
 * only when called by hand with the cron secret.
 */
export async function GET(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runSourceSync({ limit: 30 });
  return NextResponse.json({ checked: result.checked, items: result.items.map(({ applied, held, ...i }) => ({ ...i, applied: applied.length, held: held.length })) });
}
