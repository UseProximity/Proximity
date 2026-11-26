export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireImporter } from "../../../_auth";
import { cancelBatch } from "@/lib/sourceImport/jobs";

/*
 * The landlord left the import. Jobs still waiting or being read are
 * cancelled and the empty drafts made for them are deleted, so nothing
 * half-read lands on the Drafts page. Finished ones stay. Also sent as a
 * beacon while the page closes, so it answers a bodiless POST too.
 * @auth landlord
 */
export async function POST(req, { params }) {
  const gate = await requireImporter();
  if (gate.res) return gate.res;
  const { batchId } = await params;
  const body = await req.json().catch(() => ({}));
  const result = await cancelBatch({ batchId, userId: gate.userId, all: body?.all === true });
  return NextResponse.json(result);
}
