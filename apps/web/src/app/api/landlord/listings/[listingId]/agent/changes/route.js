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
import { hasDbRole } from "@/lib/userRole";
import { UUID_RE } from "@/lib/users/viewAs";
import supabase from "@/lib/supabase";

/*
 * Who may act on the sync's website changes (Wyatt, 2026-11-25): the
 * property's owners and super admins, and a lease's own landlord for that
 * lease alone. Holding any lease on the listing (a sublease, a co-landlord's
 * offering) is not enough to change, or see the hidden prices of, the rest.
 * The admin role is read from the database, as the admin decisions route
 * does, so a plain or demoted admin cannot overrule the sync from here.
 *   asUserId  an admin viewing as this landlord: answer for them (read only)
 */
async function accessFor(g, listingId, asUserId = null) {
  const userId = asUserId ?? g.userId;
  const owner = (await isPropertyOwner(userId, listingId)) || (!asUserId && g.isAdmin && (await hasDbRole(g.userId, ["super"])));
  return {
    userId,
    owner,
    // Any admin may read everything; only owners and super admins act.
    seesAll: owner || (!asUserId && g.isAdmin),
    mayLease: async (leaseId) => owner || (!!leaseId && (await leasesOwnedBy(userId, [leaseId])).has(leaseId)),
  };
}

/* Of these chat messages, the ones this person wrote. */
async function messagesBy(userId, messageIds) {
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const { data } = await supabase.from("chat_messages").select("id").in("id", ids).eq("sender_id", userId);
  return new Set((data ?? []).map((m) => m.id));
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

export async function GET(req, { params }) {
  const { listingId } = await params;
  const g = await agentGate(listingId);
  if (g.res) return g.res;
  try {
    // An admin viewing as a landlord sees what that landlord would (PR 483 review).
    const viewAs = new URL(req.url).searchParams.get("viewAs");
    const asUserId = g.isAdmin && viewAs && UUID_RE.test(viewAs) ? viewAs : null;
    const [rows, allHidden, access] = await Promise.all([recentDecisions({ listingId, days: 30, limit: 300 }), hiddenPricesFor(listingId), accessFor(g, listingId, asUserId)]);
    const { owner, seesAll, userId } = access;
    // Hidden prices and the Undo / Apply now buttons: the property's owners
    // see all of them, anyone else only those for leases they own.
    const own = seesAll ? null : await leasesOwnedBy(userId, [...rows.map((r) => r.leaseId), ...allHidden.map((h) => h.leaseId)]);
    const sees = (leaseId) => seesAll || (!!leaseId && own.has(leaseId));
    const acts = (leaseId) => owner || (!!leaseId && !seesAll && own.has(leaseId));
    const hidden = allHidden.filter((h) => sees(h.leaseId));
    // A chat message is private to the two people in it: its words are shown
    // to the landlord who wrote it (and the team), never to another landlord
    // on the same listing (PR 483 review).
    const mine = await messagesBy(userId, rows.map((r) => r.messageId));
    const teamView = g.isAdmin && !asUserId;
    const withQuote = (r) => (!r.change.quote || teamView || mine.has(r.messageId) ? r.change : { ...r.change, quote: null });
    // The landlord sees the change, whether it applied, and why; not the scoring internals.
    return NextResponse.json({ rows: rows.map((r) => ({ id: r.id, at: r.at, status: r.status, change: withQuote(r), source: r.source, reason: landlordReason(r.reason), canUndo: r.canUndo && acts(r.leaseId), canApply: r.canApply && acts(r.leaseId) })), hidden });
  } catch (err) {
    console.error("GET agent/changes failed:", err);
    return NextResponse.json({ error: "Could not load website changes" }, { status: 500 });
  }
}
