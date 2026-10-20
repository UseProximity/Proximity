export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { cronAuthorized } from "@/app/api/landlord/import/_auth";
import { runPendingJobs, requeueStuck } from "@/lib/sourceImport/jobs";

// Every couple of minutes: put dead runs back on the queue and drain it.
export async function GET(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requeued = await requeueStuck();
  const ran = await runPendingJobs({ budgetMs: 240000 });
  return NextResponse.json({ ran, requeued });
}
