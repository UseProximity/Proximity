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

// GET /api/landlord/listings/[listingId]/pet-policy
export async function GET(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;
  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("listing_pet_policies")
    .select("*")
    .eq("listing_id", listingId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? { listing_id: listingId, policy_text: "" });
}

// PUT /api/landlord/listings/[listingId]/pet-policy
// Body: { policy_text: string }
export async function PUT(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;
  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { policy_text } = await req.json();
  if (typeof policy_text !== "string")
    return NextResponse.json({ error: "policy_text required" }, { status: 400 });

  const { data, error } = await supabase
    .from("listing_pet_policies")
    .upsert({ listing_id: listingId, policy_text, last_verified_at: new Date().toISOString(), last_verified_source: "landlord_self" }, { onConflict: "listing_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
