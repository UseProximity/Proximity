/*
 * POST /api/landlord/tours/[tourId]
 *   { action: "confirm", slot }      confirm one of the student's times
 *   { action: "propose", slots }     propose other times
 *   { action: "cancel" }
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { landlordAct } from "@/lib/agents/tours";

export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { tourId } = await params;
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const result = await landlordAct({ tourId, landlordId: session.user.id, action: body?.action, slot: body?.slot ?? null, slots: body?.slots ?? [] });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/landlord/tours/[id] failed:", err);
    return NextResponse.json({ error: "Could not update the tour" }, { status: 500 });
  }
}
