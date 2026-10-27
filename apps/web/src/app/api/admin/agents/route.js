/*
 * /api/admin/agents: the team's view of the per-listing agents.
 *
 *   GET            counts: agents by status, facts by section, sources by
 *                  kind, open held or proposed changes
 *   POST           { action: "seed", listingId? }   seed one listing, or every
 *                                                   live listing (idempotent)
 *                  { action: "status", listingId, status }  flip a listing's
 *                                                   switch: off, pilot or on
 *
 * Super and admin only. Seeding is how the knowledge store is first filled on
 * production (prod writes are never done from a developer machine).
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { seedListing, seedAll } from "@/lib/agents/seed";
import { ensureAgent } from "@/lib/agents/store";
import { overview } from "@/lib/agents/overview";

async function requireTeam() {
  const session = await auth();
  if (!session?.user?.id) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!["super", "admin"].includes(session.user.role)) {
    return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { userId: session.user.id };
}

export async function GET() {
  const gate = await requireTeam();
  if (gate.res) return gate.res;
  try {
    return NextResponse.json(await overview());
  } catch (err) {
    console.error("[agents] overview failed:", err);
    return NextResponse.json({ error: "Could not load agents" }, { status: 500 });
  }
}

export async function POST(req) {
  const gate = await requireTeam();
  if (gate.res) return gate.res;
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const action = body?.action;
  try {
    if (action === "seed") {
      const result = body.listingId
        ? await seedListing(body.listingId, { actorId: gate.userId })
        : await seedAll({ onlyUnseeded: !!body.onlyUnseeded });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "status") {
      if (!["off", "pilot", "on"].includes(body.status) || !body.listingId) {
        return NextResponse.json({ error: "listingId and a status of off, pilot or on are required" }, { status: 400 });
      }
      await ensureAgent(body.listingId);
      const { error } = await supabase.from("listing_agents").update({ status: body.status }).eq("listing_id", body.listingId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[agents] admin action failed:", err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
