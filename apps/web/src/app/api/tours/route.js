/*
 * GET  /api/tours                 the signed-in student's tour requests
 *                                 (?listingId= narrows to the open one there)
 * POST /api/tours                 { listingId, leaseId?, slots, proxyThreadId? }
 *                                 request a tour. Saves the pattern too when
 *                                 one is sent.
 *
 * @auth user
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import { requestTour, listStudentTours, openTourFor } from "@/lib/agents/tours";
import { agentsEnabled } from "@/lib/agents/flags";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
  const user = await getRequestUser(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const listingId = new URL(req.url).searchParams.get("listingId");
    if (listingId && UUID.test(listingId)) return NextResponse.json({ tour: await openTourFor({ studentId: user.id, listingId }) });
    return NextResponse.json({ tours: await listStudentTours(user.id) });
  } catch (err) {
    console.error("GET /api/tours failed:", err);
    return NextResponse.json({ error: "Could not load tours" }, { status: 500 });
  }
}

export async function POST(req) {
  const user = await getRequestUser(req);
  if (!user?.id) return NextResponse.json({ error: "Sign in to book a tour.", code: "SIGN_IN" }, { status: 401 });
  if (!agentsEnabled()) return NextResponse.json({ error: "Tour booking is not available yet." }, { status: 404 });
  try {
    let body;
    try { body = await req.json(); } catch { body = {}; }
    if (!UUID.test(body?.listingId ?? "")) return NextResponse.json({ error: "listingId is required" }, { status: 400 });
    const result = await requestTour({
      listingId: body.listingId, leaseId: UUID.test(body?.leaseId ?? "") ? body.leaseId : null, studentId: user.id,
      slots: body.slots, proxyThreadId: UUID.test(body?.proxyThreadId ?? "") ? body.proxyThreadId : null,
    });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/tours failed:", err);
    return NextResponse.json({ error: "Could not request the tour" }, { status: 500 });
  }
}
