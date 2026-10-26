export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse, after } from "next/server";
import { requireImporter } from "../../_auth";
import { loadBatch, keepBatchMoving, runLanes } from "@/lib/sourceImport/jobs";

// The workspace's poll: every job in the batch and the listing behind it.
// The poll also keeps the batch alive: a runner that died with its function
// (Vercel's five-minute cap, no cron on previews) is replaced here, so a
// landlord watching the page is all a batch needs to finish.
// @auth landlord
export async function GET(req, { params }) {
  const gate = await requireImporter();
  if (gate.res) return gate.res;
  const { batchId } = await params;
  const lanes = await keepBatchMoving({ batchId, userId: gate.userId });
  if (lanes > 0) after(() => runLanes({ batchId, userId: gate.userId, lanes }));
  const batch = await loadBatch({ batchId, userId: gate.userId });
  if (!batch) return NextResponse.json({ error: "No such import." }, { status: 404 });
  return NextResponse.json(batch);
}
