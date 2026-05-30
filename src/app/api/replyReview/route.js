import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { insertAsUser } from "@/lib/supabaseWithUser";

export async function POST(req) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      console.log("POST /api/reviewReply failed: Unauthorized");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    const { reviewId, reply } = body;

    if (!reviewId || !reply?.trim()) {
      console.log("POST /api/reviewReply failed: Missing fields", { body });
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { data: review } = await supabase
      .from("listing_reviews")
      .select(
        `
        id,
        listing:listings!listing_id(
          primary_landlord_id
        )
      `
      )
      .eq("id", reviewId)
      .single();

    if (!review) {
      console.log("POST /api/reviewReply failed: Review not found");
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    if (!review.listing) {
      console.log("POST /api/reviewReply failed: Listing not found for review");
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (review.listing.primary_landlord_id !== session.user.id) {
      console.log("POST /api/reviewReply failed: User not authorized to reply");
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: newReply, error } = await insertAsUser(supabase, {
      userId: session.user.id,
      table: "listing_review_replies",
      data: {
        review_id: reviewId,
        user_id: session.user.id,
        reply: reply.trim(),
      },
    });

    if (error) {
      console.error("POST /api/reviewReply failed:", error);

      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json(newReply);
  } catch (e) {
    console.error("POST /api/reviewReply failed:", e);

    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
