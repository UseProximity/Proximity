export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { cronAuthorized } from "@/app/api/landlord/import/_auth";
import { runSourceSync } from "@/lib/sourceImport/sync";

/*
 * The recurring website sync. Weekly in vercel.json; each monitor carries
 * its own interval, so this can run daily and only the due ones are read.
 */
export async function GET(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runSourceSync({ limit: 30 });
  return NextResponse.json({ checked: result.checked, items: result.items.map(({ applied, held, ...i }) => ({ ...i, applied: applied.length, held: held.length })) });
}
