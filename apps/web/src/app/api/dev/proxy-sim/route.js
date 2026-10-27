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
      const result = await answerQuestion({ questionId: body.questionId, landlordUserId: body.asUserId ?? q.owner_id, body: body.body, done: body.done !== false, via: "app" });
      return NextResponse.json(result);
    }
    if (body.action === "facts") {
      const facts = await currentFacts(body.listingId);
      return NextResponse.json({ facts: facts.map((f) => ({ section: f.section, key: f.field_key, scope: f.scope_level, summary: f.summary, landlordSet: f.landlord_set, value: f.value })) });
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
