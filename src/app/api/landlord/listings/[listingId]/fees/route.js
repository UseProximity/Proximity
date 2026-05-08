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

// GET /api/landlord/listings/[listingId]/fees
// Returns all fees for the listing, joined with fee_type display info.
export async function GET(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;
  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("listing_fees")
    .select("*, fee_types(name, category, display_label, sort_order)")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/landlord/listings/[listingId]/fees
// Body: { fee_type_id, amount, basis, listing_lease_id?, conditions?, refundable?, notes? }
export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;
  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { fee_type_id, amount, basis } = body;
  if (!fee_type_id || amount == null || !basis)
    return NextResponse.json({ error: "fee_type_id, amount, basis required" }, { status: 400 });

  const VALID_BASIS = ["flat", "per_person", "per_bed", "per_unit", "per_day", "per_bedroom_per_month", "percentage"];
  if (!VALID_BASIS.includes(basis))
    return NextResponse.json({ error: `basis must be one of: ${VALID_BASIS.join(", ")}` }, { status: 400 });

  const { data, error } = await supabase
    .from("listing_fees")
    .insert({
      listing_id: listingId,
      fee_type_id,
      amount: Number(amount),
      basis,
      listing_lease_id: body.listing_lease_id ?? null,
      conditions: body.conditions ?? null,
      refundable: body.refundable ?? null,
      notes: body.notes ?? null,
    })
    .select("*, fee_types(name, category, display_label)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
