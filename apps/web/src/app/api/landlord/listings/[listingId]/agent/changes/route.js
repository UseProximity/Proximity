/*
 * POST /api/landlord/listings/[listingId]/agent/changes
 *   { kind: "fact" | "source", eventId, decision: "approve" | "reject" }
 *   { revert: eventId }
 *   { undo: eventId } | { applyNow: eventId }   a website change the sync decided
 * GET  the website changes of the last 30 days, applied or not, with why
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
import { recentDecisions, undoChange, applyNow } from "@/lib/sourceImport/decisions";

export async function POST(req, { params }) {
  const { listingId } = await params;
  const g = await agentGate(listingId);
  if (g.res) return g.res;
  const body = await readJson(req);
  try {
    // Website changes the sync decided: undo an applied one, apply one it left.
    if (body?.undo || body?.applyNow) {
      const w = body.undo
        ? await undoChange({ listingId, eventId: body.undo, userId: g.userId })
        : await applyNow({ listingId, eventId: body.applyNow, userId: g.userId, isAdmin: g.isAdmin });
      if (w.error) return NextResponse.json({ error: w.error }, { status: 400 });
      return NextResponse.json(w);
    }
    const r = body?.revert
      ? await revertEvent({ listingId, userId: g.userId, isAdmin: g.isAdmin, eventId: body.revert })
      : await decideChange({ listingId, userId: g.userId, isAdmin: g.isAdmin, kind: body?.kind, eventId: body?.eventId, decision: body?.decision });
    // Blocked by the listing gate: the page offers the fix (sign an addendum, or Billing).
    if (r.error && r.blocked) return NextResponse.json({ ...(r.blocked.gate ?? {}), error: r.error, blocked: { kind: r.blocked.kind, unitName: r.blocked.unitName } }, { status: 403 });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error("POST agent/changes failed:", err);
    return NextResponse.json({ error: "Could not apply that" }, { status: 500 });
  }
}

export async function GET(_req, { params }) {
  const { listingId } = await params;
  const g = await agentGate(listingId);
  if (g.res) return g.res;
  try {
    const rows = await recentDecisions({ listingId, days: 30, limit: 300 });
    // The landlord sees the change, whether it applied, and why; not the scoring internals.
    return NextResponse.json({ rows: rows.map((r) => ({ id: r.id, at: r.at, status: r.status, change: r.change, source: r.source, reason: r.reason, canUndo: r.canUndo, canApply: r.canApply })) });
  } catch (err) {
    console.error("GET agent/changes failed:", err);
    return NextResponse.json({ error: "Could not load website changes" }, { status: 500 });
  }
}
