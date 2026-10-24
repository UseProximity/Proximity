export const dynamic = "force-dynamic";
// Creating the drafts is quick; the reads run after the response goes out.
export const maxDuration = 300;

import { NextResponse, after } from "next/server";
import supabase from "@/lib/supabase";
import { requireImporter } from "../_auth";
import { createImportBatch, runLanes, MAX_TARGETS } from "@/lib/sourceImport/jobs";

/*
 * Continue on the picker. Body: { pastedUrl, targets: [{ name, address, url,
 * levelUrl, alreadyListed }] }. Makes one draft listing and one job per
 * target, starts reading in the background, and returns the batch for the
 * workspace to poll.
 *
 * @auth landlord
 */
export async function POST(req) {
  const gate = await requireImporter();
  if (gate.res) return gate.res;
  const body = await req.json().catch(() => ({}));
  const pastedUrl = typeof body.pastedUrl === "string" ? body.pastedUrl.trim().slice(0, 500) : "";
  const targets = Array.isArray(body.targets) ? body.targets.filter((t) => t && typeof t.name === "string") : [];
  if (!pastedUrl || !targets.length) {
    return NextResponse.json({ error: "Tick at least one property first." }, { status: 400 });
  }
  if (targets.length > MAX_TARGETS) {
    return NextResponse.json({ error: `Import up to ${MAX_TARGETS} properties at a time.` }, { status: 400 });
  }
  const { data: user } = await supabase.from("users").select("name, email, phone").eq("id", gate.userId).maybeSingle();
  try {
    const batch = await createImportBatch({ userId: gate.userId, user, pastedUrl, targets, batchId: typeof body.batchId === "string" ? body.batchId : null });
    after(() => runLanes({ batchId: batch.batchId }));
    return NextResponse.json(batch, { status: 202 });
  } catch (err) {
    console.error("[import/start]", err?.message);
    return NextResponse.json({ error: "We couldn't start that import. Please try again." }, { status: 500 });
  }
}
