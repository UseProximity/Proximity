/*
 * POST /api/tours/[tourId]  { action: "pick", slot } | { action: "cancel" }
 * The student's side of a tour request.
 *
 * @auth user
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import { studentAct } from "@/lib/agents/tours";

export async function POST(req, { params }) {
  const user = await getRequestUser(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { tourId } = await params;
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const result = await studentAct({ tourId, studentId: user.id, action: body?.action, slot: body?.slot ?? null });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/tours/[id] failed:", err);
    return NextResponse.json({ error: "Could not update the tour" }, { status: 500 });
  }
}
