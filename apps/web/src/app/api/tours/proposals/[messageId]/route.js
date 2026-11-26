/*
 * POST /api/tours/proposals/[messageId]  { decision: "confirm" | "decline" }
 *
 * The answer to a tour time suggested in a tour's direct chat (Wyatt,
 * 2026-11-02): confirm books or moves the tour to it, decline leaves the tour
 * as it was. Only the person it was suggested to can answer. See
 * lib/agents/tourProposals.js.
 *
 * @auth user
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import { respondToProposal } from "@/lib/agents/tourProposals";

export async function POST(req, { params }) {
  const user = await getRequestUser(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { messageId } = await params;
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const r = await respondToProposal({ messageId, userId: user.id, decision: body?.decision === "confirm" ? "confirm" : "decline" });
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error("POST /api/tours/proposals/[messageId] failed:", err);
    return NextResponse.json({ error: "Could not update the tour" }, { status: 500 });
  }
}
