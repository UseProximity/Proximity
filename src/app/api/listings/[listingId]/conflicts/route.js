import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

// GET /api/listings/[listingId]/conflicts
// Returns in-flight listing_active_conversations for a listing.
// Students see a non-identifying count; landlords see the full list.
export async function GET(_req, { params }) {
  const session = await auth();
  const { listingId } = await params;

  const { data, error } = await supabase
    .from("listing_active_conversations")
    .select("id, state, listing_lease_id, started_at, last_activity_at")
    .eq("listing_id", listingId)
    .is("closed_at", null)
    .in("state", ["application_pending", "lease_pending"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Public-facing: return only the count so students can see "N active applications"
  // without exposing other tenants' identities.
  const isLandlord = session?.user?.role === "landlord" || session?.user?.role === "super";
  if (!isLandlord) {
    // Verify landlord ownership before returning full list
    return NextResponse.json({ active_count: data?.length ?? 0 });
  }

  // Landlord: verify ownership
  const { data: own } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("listing_id", listingId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!own && session.user.role !== "super")
    return NextResponse.json({ active_count: data?.length ?? 0 });

  return NextResponse.json(data ?? []);
}

// POST /api/listings/[listingId]/conflicts
// Creates or updates a listing_active_conversations row for the current user.
// Body: { state, listing_lease_id? }
export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;

  const { state, listing_lease_id } = await req.json();
  const VALID = ["inquired", "tour_requested", "tour_completed", "application_pending", "lease_pending", "leased", "declined"];
  if (!VALID.includes(state))
    return NextResponse.json({ error: `state must be one of: ${VALID.join(", ")}` }, { status: 400 });

  const { data, error } = await supabase
    .from("listing_active_conversations")
    .upsert({
      listing_id: listingId,
      student_user_id: session.user.id,
      listing_lease_id: listing_lease_id ?? null,
      state,
      last_activity_at: new Date().toISOString(),
    }, { onConflict: "listing_id,student_user_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
