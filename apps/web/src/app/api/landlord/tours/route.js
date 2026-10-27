/*
 * GET /api/landlord/tours: the signed-in landlord's tour requests, open
 * first. The student's name shows from the request on; contact details only
 * once confirmed.
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveDashboardUserId } from "@/lib/users/viewAs";
import { listLandlordTours } from "@/lib/agents/tours";

export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const userId = resolveDashboardUserId(session, new URL(req.url).searchParams);
    const tours = await listLandlordTours(userId);
    return NextResponse.json({ tours, openCount: tours.filter((t) => ["requested", "proposed"].includes(t.status)).length });
  } catch (err) {
    console.error("GET /api/landlord/tours failed:", err);
    return NextResponse.json({ error: "Could not load tours" }, { status: 500 });
  }
}
