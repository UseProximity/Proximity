export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse, after } from "next/server";
import supabase from "@/lib/supabase";
import { requireImporter } from "../../_auth";
import { runPendingJobs } from "@/lib/sourceImport/jobs";

async function ownJob(jobId, userId) {
  const { data } = await supabase.from("listing_import_jobs").select("id, status, batch_id, listing_id").eq("id", jobId).eq("user_id", userId).maybeSingle();
  return data ?? null;
}

// Try a failed read again. @auth landlord
export async function POST(req, { params }) {
  const gate = await requireImporter();
  if (gate.res) return gate.res;
  const { jobId } = await params;
  const job = await ownJob(jobId, gate.userId);
  if (!job) return NextResponse.json({ error: "No such job." }, { status: 404 });
  if (!["failed", "cancelled", "done"].includes(job.status)) {
    return NextResponse.json({ error: "That one is still being read." }, { status: 409 });
  }
  await supabase.from("listing_import_jobs").update({ status: "queued", step: "Waiting to read", error: null, progress: 0 }).eq("id", jobId);
  after(() => runPendingJobs({ batchId: job.batch_id, budgetMs: 270000 }).catch(() => {}));
  return NextResponse.json({ ok: true });
}

// Drop a property from the import. Its draft, if any, is removed too; a
// listing that already existed is left alone. @auth landlord
export async function DELETE(req, { params }) {
  const gate = await requireImporter();
  if (gate.res) return gate.res;
  const { jobId } = await params;
  const job = await ownJob(jobId, gate.userId);
  if (!job) return NextResponse.json({ error: "No such job." }, { status: 404 });
  if (job.listing_id) {
    const { data: l } = await supabase.from("listings").select("id, published_at").eq("id", job.listing_id).maybeSingle();
    if (l && l.published_at === null) {
      await supabase.from("listings").update({ deleted_at: new Date().toISOString() }).eq("id", l.id);
    }
  }
  await supabase.from("listing_import_jobs").update({ status: "cancelled", step: "Removed" }).eq("id", jobId);
  return NextResponse.json({ ok: true });
}
