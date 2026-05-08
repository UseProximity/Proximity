import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

async function requireOwnership(listingId, userId, role) {
  if (role === "super") return true;
  const { data } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("listing_id", listingId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

// GET /api/landlord/listings/[listingId]/field-states
// Optional ?state=ai_suggested to filter by state.
export async function GET(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;
  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const stateFilter = searchParams.get("state");

  let query = supabase
    .from("listing_field_states")
    .select("*")
    .eq("listing_id", listingId)
    .order("last_changed_at", { ascending: false });

  if (stateFilter) query = query.eq("state", stateFilter);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/landlord/listings/[listingId]/field-states
// Upserts field state via the upsert_field_state RPC.
// Body: { table_name, record_id, field_name, state, source?, ai_confidence?, evidence?, suggested_value? }
// Or bulk: { fields: [{ table_name, record_id, field_name, state }] }
export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;
  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const VALID_STATES = ["confirmed", "ai_suggested", "empty", "rejected"];

  // Bulk confirm path
  if (Array.isArray(body.fields)) {
    const results = [];
    for (const f of body.fields) {
      if (!f.table_name || !f.record_id || !f.field_name || !VALID_STATES.includes(f.state)) continue;
      const { data } = await supabase.rpc("upsert_field_state", {
        p_listing_id: listingId,
        p_table_name: f.table_name,
        p_record_id: f.record_id,
        p_field_name: f.field_name,
        p_state: f.state,
        p_source: f.source ?? null,
        p_ai_confidence: f.ai_confidence ?? null,
        p_evidence: f.evidence ?? null,
        p_suggested_value: f.suggested_value ?? null,
        p_changed_by: session.user.id,
      });
      results.push(data);
    }
    return NextResponse.json({ updated: results.length });
  }

  // Single upsert path
  const { table_name, record_id, field_name, state } = body;
  if (!table_name || !record_id || !field_name || !VALID_STATES.includes(state))
    return NextResponse.json({ error: "table_name, record_id, field_name, state required" }, { status: 400 });

  const { data, error } = await supabase.rpc("upsert_field_state", {
    p_listing_id: listingId,
    p_table_name: table_name,
    p_record_id: record_id,
    p_field_name: field_name,
    p_state: state,
    p_source: body.source ?? null,
    p_ai_confidence: body.ai_confidence ?? null,
    p_evidence: body.evidence ?? null,
    p_suggested_value: body.suggested_value ?? null,
    p_changed_by: session.user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data });
}
