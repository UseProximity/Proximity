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

// GET /api/landlord/listings/[listingId]/concessions
export async function GET(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;
  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("listing_concessions")
    .select("*")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/landlord/listings/[listingId]/concessions
// Body: { description, amount?, amount_type?, conditions?, valid_from?, valid_until?, listing_lease_id? }
export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;
  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  if (!body.description?.trim())
    return NextResponse.json({ error: "description required" }, { status: 400 });
  if (body.amount_type && !["flat", "percentage", "months_free"].includes(body.amount_type))
    return NextResponse.json({ error: "amount_type must be flat, percentage, or months_free" }, { status: 400 });

  const { data, error } = await supabase
    .from("listing_concessions")
    .insert({
      listing_id: listingId,
      listing_lease_id: body.listing_lease_id ?? null,
      description: body.description.trim(),
      amount: body.amount != null ? Number(body.amount) : null,
      amount_type: body.amount_type ?? null,
      conditions: body.conditions ?? null,
      valid_from: body.valid_from ?? null,
      valid_until: body.valid_until ?? null,
      active: body.active ?? true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
