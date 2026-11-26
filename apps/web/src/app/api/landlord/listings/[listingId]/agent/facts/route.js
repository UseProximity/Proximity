/*
 * POST /api/landlord/listings/[listingId]/agent/facts
 *   { action: "edit", factId, summary }   rewrite one fact as the landlord's
 *                                          ("Updated by you on Oct 28")
 *   { action: "delete", factId }          remove it from what Proxy knows
 *
 * The property owner edits any fact; another owner only their own leases'.
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { agentGate, readJson } from "@/lib/agents/gate";
import { editFact, deleteFact } from "@/lib/agents/landlordAgent";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req, { params }) {
  const { listingId } = await params;
  const g = await agentGate(listingId);
  if (g.res) return g.res;
  const body = await readJson(req);
  if (!UUID.test(body?.factId ?? "")) return NextResponse.json({ error: "Pick a fact" }, { status: 400 });
  try {
    const r = body.action === "delete"
      ? await deleteFact({ listingId, userId: g.userId, isAdmin: g.isAdmin, factId: body.factId })
      : await editFact({ listingId, userId: g.userId, isAdmin: g.isAdmin, factId: body.factId, summary: body.summary });
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error("POST agent/facts failed:", err);
    return NextResponse.json({ error: "Could not change that just now" }, { status: 500 });
  }
}
