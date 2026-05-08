import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

async function resolveOwnership(userId, listingId) {
  const { data } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("listing_id", listingId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

// GET /api/landlord/leases?listing_id=<uuid>
// Returns all lease offers (including inactive) for a listing the landlord owns.
export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const listingId = searchParams.get("listing_id");
  if (!listingId) return NextResponse.json({ error: "listing_id required" }, { status: 400 });

  if (session.user.role !== "super") {
    const owns = await resolveOwnership(session.user.id, listingId);
    if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("listing_leases")
    .select("*")
    .eq("listing_id", listingId)
    .is("deleted_at", null)
    .order("bedrooms", { ascending: true })
    .order("lease_term_months", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/landlord/leases
// Body: { listing_id, bedrooms, bathrooms, area?, pricing_basis, rent, beds_in_lease?,
//         lease_term_months, available_from?, sublease?, summer_only?, semester_only?,
//         unit_group_label? }
export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { listing_id, bedrooms, bathrooms, pricing_basis, rent, lease_term_months } = body;

  if (!listing_id || bedrooms == null || bathrooms == null || !pricing_basis || rent == null || !lease_term_months) {
    return NextResponse.json({ error: "listing_id, bedrooms, bathrooms, pricing_basis, rent, lease_term_months are required" }, { status: 400 });
  }
  if (!["per_unit", "per_bed"].includes(pricing_basis)) {
    return NextResponse.json({ error: "pricing_basis must be per_unit or per_bed" }, { status: 400 });
  }

  if (session.user.role !== "super") {
    const owns = await resolveOwnership(session.user.id, listing_id);
    if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("listing_leases")
    .insert({
      listing_id,
      bedrooms: Number(bedrooms),
      bathrooms: Number(bathrooms),
      area: body.area ?? null,
      pricing_basis,
      rent: Number(rent),
      beds_in_lease: body.beds_in_lease ?? null,
      lease_term_months: Number(lease_term_months),
      available_from: body.available_from ?? null,
      sublease: body.sublease ?? false,
      total_bedrooms: body.total_bedrooms != null ? Number(body.total_bedrooms) : null,
      total_bathrooms: body.total_bathrooms != null ? Number(body.total_bathrooms) : null,
      summer_only: body.summer_only ?? false,
      semester_only: body.semester_only ?? false,
      unit_group_label: body.unit_group_label ?? null,
      is_active: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
