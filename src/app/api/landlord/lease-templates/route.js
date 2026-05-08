import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

// GET /api/landlord/lease-templates
// Lists all templates for the authenticated landlord.
// Optional ?listing_id= to filter templates attached to a specific listing.
export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const listingId = searchParams.get("listing_id");

  let query = supabase
    .from("lease_templates")
    .select("id, landlord_id, listing_id, version, display_name, template_pdf_url, is_active, uploaded_at, last_verified_at, created_at, updated_at")
    .eq("landlord_id", session.user.id)
    .order("uploaded_at", { ascending: false });

  if (listingId) query = query.eq("listing_id", listingId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/landlord/lease-templates
// Body: { display_name, template_pdf_url, listing_id? }
// The PDF must already be uploaded to R2 before calling this endpoint.
// After creation, trigger /api/landlord/lease-templates/[id]/extract to run AI extraction.
export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { display_name, template_pdf_url } = body;
  if (!display_name?.trim() || !template_pdf_url?.trim())
    return NextResponse.json({ error: "display_name and template_pdf_url required" }, { status: 400 });

  const { data, error } = await supabase
    .from("lease_templates")
    .insert({
      landlord_id: session.user.id,
      listing_id: body.listing_id ?? null,
      display_name: display_name.trim(),
      template_pdf_url: template_pdf_url.trim(),
      uploaded_by: session.user.id,
      is_active: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
