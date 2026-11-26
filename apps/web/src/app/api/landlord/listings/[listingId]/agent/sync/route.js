/*
 * The landlord's "Sync now" and sync status for one listing's agent.
 *   GET   status: source, last run, next run, failures, a running job,
 *         manual syncs left today
 *   POST  queue a sync now (3 a day per listing; admins unlimited)
 *
 * Owners of the listing (any owner may sync their own offer; the source is
 * the property's) and supers.
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";
// The sync runs after the response, in this same function.
export const maxDuration = 300;

import { NextResponse, after } from "next/server";
import { runLanes } from "@/lib/sourceImport/jobs";
import { auth } from "@/auth";
import { hasStakeInListing } from "@/lib/listings/ownership";
import { manualSync, agentSyncStatus } from "@/lib/agents/sync";

async function gate(listingId) {
  const session = await auth();
  if (!session?.user?.id) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const isAdmin = ["super", "admin"].includes(session.user.role);
  if (!isAdmin && !(await hasStakeInListing(session.user.id, listingId))) {
    return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { userId: session.user.id, isAdmin };
}

export async function GET(_req, { params }) {
  const { listingId } = await params;
  const g = await gate(listingId);
  if (g.res) return g.res;
  try {
    return NextResponse.json(await agentSyncStatus(listingId));
  } catch (err) {
    console.error("GET agent/sync failed:", err);
    return NextResponse.json({ error: "Could not load sync status" }, { status: 500 });
  }
}

export async function POST(_req, { params }) {
  const { listingId } = await params;
  const g = await gate(listingId);
  if (g.res) return g.res;
  try {
    const r = await manualSync({ listingId, userId: g.userId, isAdmin: g.isAdmin });
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
    // Start it now rather than waiting for the import-jobs cron, which only
    // runs on production (previews and local never pick a queued job up).
    if (r.job?.batch_id) after(() => runLanes({ batchId: r.job.batch_id, lanes: 1 }));
    return NextResponse.json({ ok: true, job: r.job, already: !!r.already });
  } catch (err) {
    console.error("POST agent/sync failed:", err);
    return NextResponse.json({ error: "Could not start the sync" }, { status: 500 });
  }
}
