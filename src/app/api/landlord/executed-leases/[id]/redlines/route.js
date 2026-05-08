import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { proposeChatRedlines } from "@/lib/extraction/chatRedlines";

async function resolveOwnershipForLease(leaseId, userId, role) {
  const { data, error } = await supabase
    .from("executed_leases")
    .select("id, listing_id, status")
    .eq("id", leaseId)
    .single();
  if (error || !data) return { err: "Not found", status: 404 };
  if (role !== "super") {
    const { data: own } = await supabase
      .from("listing_landlords")
      .select("listing_id")
      .eq("listing_id", data.listing_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!own) return { err: "Forbidden", status: 403 };
  }
  return { executedLease: data };
}

// GET /api/landlord/executed-leases/[id]/redlines
export async function GET(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { err, status } = await resolveOwnershipForLease(id, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  const { data, error } = await supabase
    .from("lease_redlines")
    .select("*")
    .eq("executed_lease_id", id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/landlord/executed-leases/[id]/redlines
//
// Two modes:
//   1. Manual: body = { section_label, original_text, suggested_text, ... }
//   2. AI proposal from chat: body = { action: "propose_from_chat" }
//      — reads the lease's chat_thread, calls Anthropic, inserts pending redlines.
export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { executedLease, err, status } = await resolveOwnershipForLease(id, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  const body = await req.json();

  // AI proposal path
  if (body.action === "propose_from_chat") {
    if (!process.env.ANTHROPIC_API_KEY)
      return NextResponse.json({ error: "AI extraction not configured" }, { status: 503 });

    const { data: lease } = await supabase
      .from("executed_leases")
      .select("chat_thread_id, template_id, lease_templates(template_pdf_text)")
      .eq("id", id)
      .single();

    if (!lease?.chat_thread_id)
      return NextResponse.json({ error: "No chat thread linked to this lease" }, { status: 422 });

    const templateText = lease.lease_templates?.template_pdf_text ?? "";
    if (!templateText)
      return NextResponse.json({ error: "Template text not available — run extraction on the template first" }, { status: 422 });

    try {
      const result = await proposeChatRedlines(id, templateText, lease.chat_thread_id, session.user.id);
      return NextResponse.json(result, { status: 201 });
    } catch (aiErr) {
      console.error("[redlines propose_from_chat]", aiErr.message);
      return NextResponse.json({ error: aiErr.message }, { status: 500 });
    }
  }

  // Manual creation path
  const { section_label, original_text, suggested_text } = body;
  if (!section_label?.trim() || !original_text?.trim() || !suggested_text?.trim())
    return NextResponse.json({ error: "section_label, original_text, suggested_text required" }, { status: 400 });

  const { data, error } = await supabase
    .from("lease_redlines")
    .insert({
      executed_lease_id: id,
      section_label: section_label.trim(),
      section_anchor: body.section_anchor ?? null,
      original_text: original_text.trim(),
      suggested_text: suggested_text.trim(),
      rationale: body.rationale ?? null,
      rationale_chat_message_id: body.rationale_chat_message_id ?? null,
      ai_confidence: body.ai_confidence ?? null,
      status: "pending",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
