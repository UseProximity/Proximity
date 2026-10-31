/*
 * POST /api/landlord/tours/[tourId]
 *   { action: "confirm", day, time }  confirm a start time ("HH:MM") on one of
 *                                     the student's days, inside their window
 *   { action: "message", body }       none of it works: write to the student
 *                                     directly (opens the direct chat)
 *   { action: "cancel" }
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { landlordAct } from "@/lib/agents/tours";
import { resolveDashboardUserId } from "@/lib/users/viewAs";

export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { tourId } = await params;
    let body;
    try { body = await req.json(); } catch { body = {}; }
    // A super "viewing as" a landlord acts as that landlord.
    const landlordId = resolveDashboardUserId(session, new URL(req.url).searchParams);
    const result = await landlordAct({ tourId, landlordId, action: body?.action, day: body?.day ?? null, time: body?.time ?? null, body: body?.body ?? "" });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/landlord/tours/[id] failed:", err);
    return NextResponse.json({ error: "Could not update the tour" }, { status: 500 });
  }
}
