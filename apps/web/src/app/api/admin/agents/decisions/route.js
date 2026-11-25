/*
 * GET  /api/admin/agents/decisions?days=2&listingId=
 *      What the website sync decided: every change with its source, score and
 *      reason, and what the other version (rules or scores) would have done.
 * POST { action: "undo" | "applyNow", listingId, eventId }
 *      Overrule one decision. Super admins only.
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireDbRole } from "@/lib/userRole";
import { recentDecisions, undoChange, applyNow } from "@/lib/sourceImport/decisions";
import { ledgerDecides } from "@/lib/sourceImport/shadowStore";

async function requireTeam() {
  const session = await auth();
  if (!session?.user?.id) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!["super", "admin"].includes(session.user.role)) return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: session.user.id };
}

export async function GET(req) {
  const g = await requireTeam();
  if (g.res) return g.res;
  try {
    const url = new URL(req.url);
    const days = Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 2));
    const rows = await recentDecisions({ listingId: url.searchParams.get("listingId") || null, days });
    return NextResponse.json({
      days,
      decidedBy: ledgerDecides() ? "scores" : "rules",
      counts: { applied: rows.filter((r) => r.status === "applied").length, notApplied: rows.filter((r) => r.status === "not_applied").length, borderline: rows.filter((r) => r.borderline).length, undone: rows.filter((r) => r.status === "undone").length },
      rows,
    });
  } catch (err) {
    console.error("GET admin/agents/decisions failed:", err);
    return NextResponse.json({ error: "Could not load the sync's decisions" }, { status: 500 });
  }
}

export async function POST(req) {
  const g = await requireTeam();
  if (g.res) return g.res;
  if (!(await requireDbRole(["super"]))) return NextResponse.json({ error: "Only super admins can overrule the sync." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body?.listingId || !body?.eventId || !["undo", "applyNow"].includes(body.action)) return NextResponse.json({ error: "Missing the change to act on" }, { status: 400 });
  try {
    const r = body.action === "undo"
      ? await undoChange({ listingId: body.listingId, eventId: body.eventId, userId: g.userId })
      : await applyNow({ listingId: body.listingId, eventId: body.eventId, userId: g.userId, isAdmin: true });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error("POST admin/agents/decisions failed:", err);
    return NextResponse.json({ error: "Could not do that" }, { status: 500 });
  }
}
