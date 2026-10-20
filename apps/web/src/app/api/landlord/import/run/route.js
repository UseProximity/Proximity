export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireImporter, cronAuthorized } from "../_auth";
import { runPendingJobs, requeueStuck } from "@/lib/sourceImport/jobs";

/*
 * Drain the queue. The workspace calls this when it sees queued jobs and no
 * runner moving them (a runner that died with its function); the cron calls
 * it with the secret. A landlord only ever runs their own jobs.
 * @auth landlord
 */
export async function POST(req) {
  if (cronAuthorized(req)) {
    const requeued = await requeueStuck();
    const ran = await runPendingJobs({ budgetMs: 240000 });
    return NextResponse.json({ ran, requeued });
  }
  const gate = await requireImporter();
  if (gate.res) return gate.res;
  const body = await req.json().catch(() => ({}));
  const ran = await runPendingJobs({ userId: gate.userId, batchId: typeof body.batchId === "string" ? body.batchId : null, budgetMs: 240000 });
  return NextResponse.json({ ran });
}
