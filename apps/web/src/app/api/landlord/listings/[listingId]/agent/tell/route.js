/*
 * POST /api/landlord/listings/[listingId]/agent/tell  { text }
 * The landlord states something about the listing; the agent stores what
 * it supports as landlord-set knowledge and reports what it saved.
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { agentGate, readJson } from "@/lib/agents/gate";
import { tellAgent } from "@/lib/agents/landlordAgent";

export async function POST(req, { params }) {
  const { listingId } = await params;
  const g = await agentGate(listingId);
  if (g.res) return g.res;
  const body = await readJson(req);
  try {
    const r = await tellAgent({ listingId, userId: g.userId, isAdmin: g.isAdmin, text: body?.text ?? "" });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error("POST agent/tell failed:", err);
    return NextResponse.json({ error: "The agent could not save that just now." }, { status: 500 });
  }
}
