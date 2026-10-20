export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireImporter } from "../../_auth";
import { loadBatch } from "@/lib/sourceImport/jobs";

// The workspace's poll: every job in the batch and the listing behind it.
// @auth landlord
export async function GET(req, { params }) {
  const gate = await requireImporter();
  if (gate.res) return gate.res;
  const { batchId } = await params;
  const batch = await loadBatch({ batchId, userId: gate.userId });
  if (!batch) return NextResponse.json({ error: "No such import." }, { status: 404 });
  return NextResponse.json(batch);
}
