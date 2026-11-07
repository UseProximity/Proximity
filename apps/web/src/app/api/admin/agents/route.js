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
 *                  Launch (Wyatt, 2026-10-31), each a batch the admin page
 *                  repeats while `remaining` > 0:
 *                  { action: "transferReport" }      what every listing has
 *                  { action: "seedBatch", since?, limit? }  a full seeding
 *                                                   pass started at `since`
 *                  { action: "backfill", maxRead? }  read old landlord chats
 *                  { action: "discover", limit?, redo?, listingId?, dryRun? }
 *                                                    search for sources of truth
 *                  { action: "foundSources" }        counts + pages to review
 *                  { action: "readFound", limit?, force?, since? }  read
 *                                    confirmed found pages into knowledge
 *                  { action: "reviewSource", id, accept }
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
import { foundSourcesEnabled } from "@/lib/agents/flags";
import { runBackfill } from "@/lib/agents/backfill";
import { runDigest } from "@/lib/agents/digest";
import { transferReport, seedBatch } from "@/lib/agents/transfer";
import { discoverBatch, foundSourcesOverview, foundSourcesToReview, reviewFoundSource } from "@/lib/agents/discover";
import { readFoundBatch, foundReadOverview } from "@/lib/agents/foundRead";

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
    if (action === "backfill") {
      // Read today's chat history into the agents (end of the project).
      return NextResponse.json({ ok: true, result: await runBackfill({ listingId: body.listingId ?? null, maxRead: Number(body.maxRead) || 12 }) });
    }
    if (action === "transferReport") {
      return NextResponse.json({ ok: true, result: await transferReport() });
    }
    if (action === "seedBatch") {
      return NextResponse.json({ ok: true, result: await seedBatch({ since: body.since ?? null, limit: Math.min(Number(body.limit) || 15, 40) }) });
    }
    // Source search and found-page reads are off for launch (Wyatt,
    // 2026-11-07): only pages a landlord gave us are sources.
    if (["discover", "readFound", "reviewSource"].includes(action) && !foundSourcesEnabled()) {
      return NextResponse.json({ error: "Source search is switched off. Only pages a landlord gave us are used." }, { status: 409 });
    }
    if (action === "discover") {
      const result = await discoverBatch({
        limit: Math.min(Number(body.limit) || 12, 30),
        redo: body.redo === true,
        listingId: body.listingId ?? null,
        dryRun: body.dryRun === true,
      });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "foundSources") {
      const [overviewCounts, review, read] = await Promise.all([foundSourcesOverview(), foundSourcesToReview({ limit: 100 }), foundReadOverview()]);
      return NextResponse.json({ ok: true, result: { ...overviewCounts, review, read, enabled: foundSourcesEnabled() } });
    }
    if (action === "readFound") {
      if (body.force === true && !body.since && !body.listingId) {
        return NextResponse.json({ error: "A forced read needs since (when the run started)." }, { status: 400 });
      }
      const result = await readFoundBatch({
        limit: Math.min(Number(body.limit) || 4, 8),
        force: body.force === true,
        since: body.since ?? null,
        listingId: body.listingId ?? null,
      });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "reviewSource") {
      if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      await reviewFoundSource({ id: body.id, accept: body.accept === true, userId: gate.userId });
      return NextResponse.json({ ok: true });
    }
    if (action === "digest") {
      return NextResponse.json({ ok: true, result: await runDigest({ email: body.send === true }) });
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
