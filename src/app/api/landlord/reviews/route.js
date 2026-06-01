export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

// GET /api/landlord/reviews — all approved reviews for the current landlord's listings
export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["landlord", "super"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const viewAsId = searchParams.get("viewAs");
  const targetUserId =
    viewAsId && session.user.role === "super" ? viewAsId : session.user.id;

  const { data: ll } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("user_id", targetUserId);

  const listingIds = (ll ?? []).map((r) => r.listing_id);
  if (listingIds.length === 0) return NextResponse.json([]);

  const { data: reviews, error } = await supabase
    .from("listing_reviews")
    .select(
      `*, reviewer:users!user_id(id, name, image), listing:listings!listing_id(id, address, title), listing_review_replies (
      id,
      reply,
      created_at,
      updated_at,
      user_id
    )`
    )
    .eq("legitimacy", true)
    .in("listing_id", listingIds)
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    (reviews || []).map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      communicationRating: r.communication_rating ?? null,
      locationRating: r.location_rating ?? null,
      valueRating: r.value_rating ?? null,
      createdAt: r.created_at,
      reviewer: r.reviewer
        ? { id: r.reviewer.id, name: r.reviewer.name, image: r.reviewer.image }
        : r.name
        ? { id: null, name: r.name, image: null }
        : null,
      listing: r.listing
        ? {
            id: r.listing.id,
            address: r.listing.address,
            title: r.listing.title,
          }
        : null,
      landlordReply: r.listing_review_replies
        ? {
            id: r.listing_review_replies.id,
            reply: r.listing_review_replies.reply,
            createdAt: r.listing_review_replies.created_at,
            updatedAt: r.listing_review_replies.updated_at,
            userId: r.listing_review_replies.user_id,
          }
        : null,
    }))
  );
}
