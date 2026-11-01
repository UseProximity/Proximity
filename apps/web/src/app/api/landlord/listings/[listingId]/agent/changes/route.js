/*
 * POST /api/landlord/listings/[listingId]/agent/changes
 *   { kind: "fact" | "source", eventId, decision: "approve" | "reject" }
 *   { revert: eventId }
 *
 * Held changes waiting on the landlord, and the change history's revert.
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { agentGate, readJson } from "@/lib/agents/gate";
import { decideChange, revertEvent } from "@/lib/agents/landlordAgent";

export async function POST(req, { params }) {
  const { listingId } = await params;
  const g = await agentGate(listingId);
  if (g.res) return g.res;
  const body = await readJson(req);
  try {
    const r = body?.revert
      ? await revertEvent({ listingId, userId: g.userId, isAdmin: g.isAdmin, eventId: body.revert })
      : await decideChange({ listingId, userId: g.userId, isAdmin: g.isAdmin, kind: body?.kind, eventId: body?.eventId, decision: body?.decision });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error("POST agent/changes failed:", err);
    return NextResponse.json({ error: "Could not apply that" }, { status: 500 });
  }
}
