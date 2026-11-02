export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { cronAuthorized } from "@/app/api/landlord/import/_auth";
import { runSourceSync } from "@/lib/sourceImport/sync";

/*
 * Run the sync on demand, for testing and for a listing someone wants
 * re-read now. ?listingId=<uuid> runs one (whether or not it is due, draft or
 * not); without it, everything due. ?email=0 skips the emails.
 * Bearer CRON_SECRET, or a signed-in super.
 * @auth super
 */
export async function GET(req) {
  if (!cronAuthorized(req)) {
    const session = await auth();
    if (session?.user?.role !== "super") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  const listingId = params.get("listingId");
  const result = await runSourceSync({ listingId, force: !!listingId, email: params.get("email") !== "0", limit: Number(params.get("limit")) || 30 });
  return NextResponse.json(result);
}

export const POST = GET;
