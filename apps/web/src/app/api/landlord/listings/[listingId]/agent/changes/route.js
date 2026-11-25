/*
 * POST /api/landlord/listings/[listingId]/agent/changes
 *   { kind: "fact" | "source", eventId, decision: "approve" | "reject" }
 *   { revert: eventId }
 *   { undo: eventId } | { applyNow: eventId }   a website change the sync decided
 *   { showPrice: leaseId }   show the price the website gives for an unpriced lease
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
import { recentDecisions, undoChange, applyNow, hiddenPricesFor, showHiddenPrice, eventLeaseId, leasesOwnedBy, landlordReason } from "@/lib/sourceImport/decisions";
import { isPropertyOwner } from "@/lib/listings/ownership";

/*
 * Who may act on the sync's website changes (Wyatt, 2026-11-25): the
 * property's owners and admins, and a lease's own landlord for that lease
 * alone. Holding any lease on the listing (a sublease, a co-landlord's
 * offering) is not enough to change, or see the hidden prices of, the rest.
 */
async function accessFor(g, listingId) {
  const owner = g.isAdmin || (await isPropertyOwner(g.userId, listingId));
  return {
    owner,
    mayLease: async (leaseId) => owner || (!!leaseId && (await leasesOwnedBy(g.userId, [leaseId])).has(leaseId)),
  };
}

export async function POST(req, { params }) {
  const { listingId } = await params;
  const g = await agentGate(listingId);
  if (g.res) return g.res;
  const body = await readJson(req);
  try {
    // Show a price the landlord's website gives for a lease they listed without one.
    const access = await accessFor(g, listingId);
    if (body?.showPrice) {
      if (!(await access.mayLease(body.showPrice))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const h = await showHiddenPrice({ listingId, leaseId: body.showPrice, userId: g.userId });
      if (h.error) return NextResponse.json({ error: h.error }, { status: 400 });
      return NextResponse.json(h);
    }
    // Website changes the sync decided: undo an applied one, apply one it left.
    if (body?.undo || body?.applyNow) {
      const leaseId = await eventLeaseId(listingId, body.undo ?? body.applyNow);
      if (leaseId === undefined) return NextResponse.json({ error: "That change is no longer there." }, { status: 404 });
      if (!(leaseId ? await access.mayLease(leaseId) : access.owner)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    const [rows, allHidden, { owner }] = await Promise.all([recentDecisions({ listingId, days: 30, limit: 300 }), hiddenPricesFor(listingId), accessFor(g, listingId)]);
    // Hidden prices and the Undo / Apply now buttons: the property's owners
    // see all of them, anyone else only those for leases they own.
    const own = owner ? null : await leasesOwnedBy(g.userId, [...rows.map((r) => r.leaseId), ...allHidden.map((h) => h.leaseId)]);
    const may = (leaseId) => owner || (!!leaseId && own.has(leaseId));
    const hidden = allHidden.filter((h) => may(h.leaseId));
    // The landlord sees the change, whether it applied, and why; not the scoring internals.
    return NextResponse.json({ rows: rows.map((r) => ({ id: r.id, at: r.at, status: r.status, change: r.change, source: r.source, reason: landlordReason(r.reason), canUndo: r.canUndo && may(r.leaseId), canApply: r.canApply && may(r.leaseId) })), hidden });
  } catch (err) {
    console.error("GET agent/changes failed:", err);
    return NextResponse.json({ error: "Could not load website changes" }, { status: 500 });
  }
}
