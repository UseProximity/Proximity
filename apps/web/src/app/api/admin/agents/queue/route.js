/*
 * /api/admin/agents/queue: the team's review queue for the per-listing
 * agents (PRD v3, "Review of held changes").
 *
 *   GET            everything waiting: fact changes held for admin (fair
 *                  housing flags, new owners' edits, owner conflicts),
 *                  fact changes held for landlords, open website changes;
 *                  plus every listing's agent status
 *   POST { kind: "fact" | "source", eventId, listingId, decision }
 *   POST { action: "status", listingId, status }   the per-listing switch
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { decideChange } from "@/lib/agents/landlordAgent";
import { ensureAgent } from "@/lib/agents/store";
import { overview } from "@/lib/agents/overview";

async function requireTeam() {
  const session = await auth();
  if (!session?.user?.id) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!["super", "admin"].includes(session.user.role)) return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: session.user.id };
}

export async function GET() {
  const g = await requireTeam();
  if (g.res) return g.res;
  try {
    const [{ data: factEvents }, { data: sourceEvents }, { data: agents }, counts] = await Promise.all([
      supabase.from("listing_fact_events").select("id, listing_id, cause, status, section, field_key, scope_level, old_value, new_value, detail, actor_id, created_at, listings!listing_id(title, address)")
        .in("status", ["held", "proposed"]).order("created_at", { ascending: false }).limit(200),
      supabase.from("listing_source_events").select("id, listing_id, kind, unit_key, field, old_value, new_value, confidence, detail, created_at, listings!listing_id(title, address)")
        .eq("status", "open").order("created_at", { ascending: false }).limit(200),
      supabase.from("listing_agents").select("listing_id, status, seeded_at, last_sync_at, listings!listing_id(title, address, published_at)").order("status").limit(2000),
      overview(),
    ]);
    const label = (e) => e.listings?.title || e.listings?.address || e.listing_id;
    return NextResponse.json({
      counts,
      forAdmin: (factEvents ?? []).filter((e) => e.detail?.adminReview).map((e) => ({ id: e.id, listingId: e.listing_id, listing: label(e), cause: e.cause, summary: e.detail?.summary ?? e.field_key, flags: e.detail?.flags ?? [], recentClaim: !!e.detail?.recentClaim, createdAt: e.created_at })),
      forLandlords: (factEvents ?? []).filter((e) => !e.detail?.adminReview).map((e) => ({ id: e.id, listingId: e.listing_id, listing: label(e), cause: e.cause, status: e.status, summary: e.detail?.summary ?? e.field_key, current: e.detail?.oldSummary ?? null, createdAt: e.created_at })),
      website: (sourceEvents ?? []).filter((e) => e.detail?.op !== "none").map((e) => ({ id: e.id, listingId: e.listing_id, listing: label(e), kind: e.kind, field: e.field, unit: e.detail?.label ?? null, old: e.old_value, new: e.new_value, confidence: e.confidence, createdAt: e.created_at })),
      gone: (sourceEvents ?? []).filter((e) => e.kind === "missing_unit" || e.kind === "listing_gone").map((e) => ({ id: e.id, listingId: e.listing_id, listing: label(e), unit: e.detail?.label ?? null, createdAt: e.created_at })),
      agents: (agents ?? []).map((a) => ({ listingId: a.listing_id, listing: a.listings?.title || a.listings?.address || a.listing_id, status: a.status, seededAt: a.seeded_at, lastSyncAt: a.last_sync_at, published: !!a.listings?.published_at })),
    });
  } catch (err) {
    console.error("GET admin/agents/queue failed:", err);
    return NextResponse.json({ error: "Could not load the queue" }, { status: 500 });
  }
}

export async function POST(req) {
  const g = await requireTeam();
  if (g.res) return g.res;
  let body;
  try { body = await req.json(); } catch { body = {}; }
  try {
    if (body?.action === "status") {
      if (!["off", "pilot", "on"].includes(body.status) || !body.listingId) return NextResponse.json({ error: "listingId and status required" }, { status: 400 });
      await ensureAgent(body.listingId);
      const { error } = await supabase.from("listing_agents").update({ status: body.status }).eq("listing_id", body.listingId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    const r = await decideChange({ listingId: body?.listingId, userId: g.userId, isAdmin: true, kind: body?.kind, eventId: body?.eventId, decision: body?.decision });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(r);
  } catch (err) {
    console.error("POST admin/agents/queue failed:", err);
    return NextResponse.json({ error: "Could not apply that" }, { status: 500 });
  }
}
