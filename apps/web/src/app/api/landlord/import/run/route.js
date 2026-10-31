export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse, after } from "next/server";
import { requireImporter, cronAuthorized } from "../_auth";
import { runPendingJobs, requeueStuck } from "@/lib/sourceImport/jobs";

/*
 * Work the queue, one job per call. The answer goes back at once and the
 * job runs after it (after()), so whoever asked (a runner handing off, the
 * workspace, the cron) is never kept waiting and the calls never nest. When
 * more jobs remain the runner asks for another call (chainRunner), so a
 * batch of any size walks through in five-minute windows.
 *
 * With the cron secret: any batch. As a landlord: their own jobs only.
 * @auth landlord
 */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const batchId = typeof body.batchId === "string" ? body.batchId : null;
  if (cronAuthorized(req)) {
    const requeued = await requeueStuck({ batchId });
    after(() => runPendingJobs({ batchId, maxJobs: 1, budgetMs: 270000 }).catch((e) => console.error("[source-import] runner:", e?.message)));
    return NextResponse.json({ started: true, requeued }, { status: 202 });
  }
  const gate = await requireImporter();
  if (gate.res) return gate.res;
  after(() => runPendingJobs({ userId: gate.userId, batchId, maxJobs: 1, budgetMs: 270000 }).catch((e) => console.error("[source-import] runner:", e?.message)));
  return NextResponse.json({ started: true }, { status: 202 });
}
