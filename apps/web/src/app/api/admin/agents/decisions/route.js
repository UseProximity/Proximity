/*
 * GET  /api/admin/agents/decisions?days=2&listingId=
 *      What the website sync decided: every change with its source, score and
 *      reason, and what the other version (rules or scores) would have done.
 * POST { action: "undo" | "applyNow", listingId, eventId }
 *      { action: "closeFix", fixId, dismiss? }   close a fix item from the Claude checker
 *      Overrule one decision. Super admins only.
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireDbRole } from "@/lib/userRole";
import { recentDecisions, undoChange, applyNow, syncHealth } from "@/lib/sourceImport/decisions";
import { ledgerDecides } from "@/lib/sourceImport/shadowStore";
import supabase from "@/lib/supabase";

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
    const [rows, health] = await Promise.all([recentDecisions({ listingId: url.searchParams.get("listingId") || null, days }), syncHealth({ days: Math.max(7, days) })]);
    return NextResponse.json({
      days,
      decidedBy: ledgerDecides() ? "scores" : "rules",
      counts: { applied: rows.filter((r) => r.status === "applied").length, notApplied: rows.filter((r) => r.status === "not_applied").length, borderline: rows.filter((r) => r.borderline).length, undone: rows.filter((r) => r.status === "undone").length },
      health,
      // What the rare Claude checker said code should have caught: work for us, newest first.
      fixItems: ((await supabase.from("sync_fix_items").select("id, listing_id, change, verdict, reason, suggested_fix, status, created_at, listings(title, address)").eq("status", "open").order("created_at", { ascending: false }).limit(50)).data ?? [])
        .map((f) => ({ id: f.id, listing: f.listings?.title ?? f.listings?.address ?? "A listing", change: f.change?.title ?? "", verdict: f.verdict, reason: f.reason, fix: f.suggested_fix, at: f.created_at })),
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
  if (body?.action === "closeFix" && body.fixId) {
    const { error } = await supabase.from("sync_fix_items").update({ status: body.dismiss ? "dismissed" : "done", closed_at: new Date().toISOString() }).eq("id", body.fixId);
    if (error) return NextResponse.json({ error: "Could not close that" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
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
