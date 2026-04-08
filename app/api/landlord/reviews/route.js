export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

// GET /api/landlord/reviews — all approved reviews for the current landlord's listings
export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["landlord", "super"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const viewAsId = searchParams.get("viewAs");
  const targetUserId = (viewAsId && session.user.role === "super") ? viewAsId : session.user.id;

  const { data: listingRows } = await supabase
    .from("listings")
    .select("id")
    .eq("landlord_id", targetUserId);

  const listingIds = (listingRows || []).map((l) => l.id);
  if (listingIds.length === 0) return NextResponse.json([]);

  const { data: reviews, error } = await supabase
    .from("reviews")
    .select("*, reviewer:users!reviews_user_id_fkey(id, name, image), listing:listings!reviews_listing_id_fkey(id, address, title)")
    .eq("legitimacy", true)
    .in("listing_id", listingIds)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    (reviews || []).map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      communicationRating: r.communication_rating ?? null,
      locationRating: r.location_rating ?? null,
      valueRating: r.value_rating ?? null,
      createdAt: r.created_at,
      reviewer: r.reviewer ? { id: r.reviewer.id, name: r.reviewer.name, image: r.reviewer.image } : r.name ? { id: null, name: r.name, image: null } : null,
      listing: r.listing ? { id: r.listing.id, address: r.listing.address, title: r.listing.title } : null,
    }))
  );
}
