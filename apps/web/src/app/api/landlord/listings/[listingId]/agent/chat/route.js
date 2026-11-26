/*
 * POST /api/landlord/listings/[listingId]/agent/chat
 *   { message, history }            talk to the agent; returns a reply and,
 *                                   when there is something to change, a
 *                                   proposal (the structured diff)
 *   { confirm: proposal }           apply a proposal the landlord confirmed
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";
// 120: the reply is two model rounds of up to 3000 tokens (see agentChat), and
// at 60 a long one was killed before it could answer.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { agentGate, readJson } from "@/lib/agents/gate";
import { agentChat, confirmProposal } from "@/lib/agents/landlordAgent";

export async function POST(req, { params }) {
  const { listingId } = await params;
  const g = await agentGate(listingId);
  if (g.res) return g.res;
  const body = await readJson(req);
  try {
    if (body?.confirm) {
      const r = await confirmProposal({ listingId, userId: g.userId, isAdmin: g.isAdmin, proposal: body.confirm });
      return NextResponse.json(r);
    }
    const r = await agentChat({ listingId, userId: g.userId, isAdmin: g.isAdmin, message: body?.message ?? "", history: Array.isArray(body?.history) ? body.history : [] });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error("POST agent/chat failed:", err);
    return NextResponse.json({ error: "The agent could not answer just now." }, { status: 500 });
  }
}
