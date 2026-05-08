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

// GET /api/landlord/executed-leases
// ?listing_id= (required) — list all lease vault entries for a listing.
// ?status= (optional) — filter by status.
export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const listingId = searchParams.get("listing_id");
  if (!listingId) return NextResponse.json({ error: "listing_id required" }, { status: 400 });

  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let query = supabase
    .from("executed_leases")
    .select(`
      id, status, listing_id, listing_lease_id, template_id,
      documenso_document_id, redlined_pdf_url, signed_lease_pdf_url,
      draft_created_at, landlord_approved_at, sent_to_tenant_at,
      tenant_signed_at, fully_executed_at, cancelled_at, cancellation_reason,
      created_at, updated_at,
      executed_lease_tenants(id, email, full_name, role, signed_at)
    `)
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false });

  const statusFilter = searchParams.get("status");
  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/landlord/executed-leases
// Creates a new draft executed lease (the starting point for the lease-vault flow).
// Body: { listing_id, listing_lease_id?, template_id?, chat_thread_id? }
export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { listing_id } = body;
  if (!listing_id) return NextResponse.json({ error: "listing_id required" }, { status: 400 });

  if (!await requireOwnership(listing_id, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("executed_leases")
    .insert({
      listing_id,
      listing_lease_id: body.listing_lease_id ?? null,
      template_id: body.template_id ?? null,
      chat_thread_id: body.chat_thread_id ?? null,
      status: "draft",
      attribution_source: body.attribution_source ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
