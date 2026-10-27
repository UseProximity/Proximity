/*
 * Per-listing agents: drive the landlord side from the command line while
 * building. DEV-ONLY (403 in production).
 *
 *   POST { action: "questions", listingId }           open and answered questions
 *   POST { action: "answer", questionId, body, done } answer as the question's owner
 *   POST { action: "facts", listingId }               current facts, one line each
 *   POST { action: "synthesize", listingId, text }    feed text into the knowledge base
 *
 * @auth public
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { answerQuestion } from "@/lib/agents/questions";
import { currentFacts, findOrCreateSource } from "@/lib/agents/store";
import { synthesizeKnowledge } from "@/lib/agents/synthesize";
import { handleQuestionEmail } from "@/lib/agents/questionEmail";
import { questionReplyToken } from "@/lib/agents/questionTokens";
import { landlordAct } from "@/lib/agents/tours";

const guard = () => process.env.NODE_ENV === "production";

export async function POST(req) {
  if (guard()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === "questions") {
      const { data } = await supabase.from("listing_questions").select("id, status, question, context, owner_id, lease_id, asked_count, answer, pending_clarifier, created_at")
        .eq("listing_id", body.listingId).order("created_at", { ascending: false }).limit(50);
      return NextResponse.json({ questions: data ?? [] });
    }
    if (body.action === "answer") {
      const { data: q } = await supabase.from("listing_questions").select("owner_id").eq("id", body.questionId).maybeSingle();
      if (!q) return NextResponse.json({ error: "no such question" }, { status: 404 });
      const result = await answerQuestion({ questionId: body.questionId, landlordUserId: body.asUserId ?? q.owner_id, body: body.body, done: typeof body.done === "boolean" ? body.done : null, via: "app" });
      return NextResponse.json(result);
    }
    if (body.action === "facts") {
      const facts = await currentFacts(body.listingId);
      return NextResponse.json({ facts: facts.map((f) => ({ section: f.section, key: f.field_key, scope: f.scope_level, summary: f.summary, landlordSet: f.landlord_set, value: f.value })) });
    }
    if (body.action === "email") {
      // A landlord's emailed reply, as the inbound processor would hand it over
      // (already authenticated). from defaults to the question's owner.
      const { data: q } = await supabase.from("listing_questions").select("id, owner_id, users:owner_id(email)").eq("id", body.questionId).maybeSingle();
      if (!q) return NextResponse.json({ error: "no such question" }, { status: 404 });
      const token = questionReplyToken({ questionId: q.id, ownerId: q.owner_id });
      const parsed = { text: body.text ?? "", html: "", from: { value: [{ address: body.from ?? q.users?.email, name: "" }] }, headers: new Map() };
      const log = [];
      const result = await handleQuestionEmail({ parsed, fromEmail: String(body.from ?? q.users?.email).toLowerCase(), token, attachments: [], logId: null, finish: async (_id, f) => { log.push(f); } });
      return NextResponse.json({ result, log });
    }
    if (body.action === "tour") {
      // The landlord's side of a tour request, as its landlord.
      const { data: t } = await supabase.from("tour_requests").select("landlord_id").eq("id", body.tourId).maybeSingle();
      if (!t) return NextResponse.json({ error: "no such tour" }, { status: 404 });
      return NextResponse.json(await landlordAct({ tourId: body.tourId, landlordId: t.landlord_id, action: body.tourAction, slot: body.slot ?? null, slots: body.slots ?? [] }));
    }
    if (body.action === "backfill") {
      const { runBackfill } = await import("@/lib/agents/backfill");
      return NextResponse.json(await runBackfill({ limit: Number(body.limit) || 50, listingId: body.listingId ?? null }));
    }
    if (body.action === "digest") {
      const { runDigest } = await import("@/lib/agents/digest");
      return NextResponse.json(await runDigest({ email: body.send === true }));
    }
    if (body.action === "addurl") {
      // A landlord adds a website to a live listing, then the queued job runs inline.
      const { addUrl } = await import("@/lib/agents/sync");
      const { runJob } = await import("@/lib/sourceImport/jobs");
      const { data: owner } = await supabase.from("listing_landlords").select("user_id").eq("listing_id", body.listingId).eq("is_primary", true).maybeSingle();
      const r = await addUrl({ listingId: body.listingId, url: body.url, userId: owner?.user_id ?? null });
      if (r.error) return NextResponse.json(r, { status: r.status ?? 400 });
      const job = await runJob(r.job.id);
      return NextResponse.json({ job: { id: job.id, status: job.status, step: job.step, error: job.error, result: job.result } });
    }
    if (body.action === "sync") {
      // One listing's sync, inline, as the daily job would run it.
      const { ensureMonitors, monitorFor, syncMonitor } = await import("@/lib/sourceImport/sync");
      await ensureMonitors();
      const m = await monitorFor(body.listingId);
      if (!m) return NextResponse.json({ error: "no monitor for this listing" }, { status: 404 });
      const item = await syncMonitor(m, { force: body.force !== false, autoApply: body.propose ? false : null, email: false });
      return NextResponse.json({ ...item, applied: item.applied.map((c) => `${c.kind} ${c.field ?? ""} ${c.note ?? ""}`), held: item.held.map((c) => `${c.kind} ${c.field ?? ""} ${c.note ?? ""}`) });
    }
    if (body.action === "synthesize") {
      const source = await findOrCreateSource({ listingId: body.listingId, kind: "admin", label: `dev sim ${Date.now()}` });
      const result = await synthesizeKnowledge({ listingId: body.listingId, text: body.text, sourceKind: body.sourceKind ?? "landlord_statement", sourceId: source.id, cause: "admin", landlordSet: !!body.landlordSet });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[proxy-sim]", err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
