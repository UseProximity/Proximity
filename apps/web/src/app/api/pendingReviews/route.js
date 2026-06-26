import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Get listing IDs owned by this user via listing_landlords
    const { data: ll } = await supabase
      .from("listing_landlords")
      .select("listing_id")
      .eq("user_id", userId);

    const listingIds = (ll ?? []).map((r) => r.listing_id);

    // Fetch pending reviews for those listings
    let pendingReviews = [];
    if (listingIds.length > 0) {
      const { data: reviews, error } = await supabase
        .from("listing_reviews")
        .select("*, reviewer:users!user_id(name, image), listings(address)")
        .eq("legitimacy", false)
        .in("listing_id", listingIds);

      if (error) {
        console.error("Error fetching pending reviews:", error);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
      }
      pendingReviews = reviews || [];
    }

    return NextResponse.json(pendingReviews);
  } catch (error) {
    console.error("Error fetching pending reviews:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// Verify the current user is allowed to act on this review (owns the listing)
async function verifyReviewOwnership(reviewId, userId) {
  const { data: review, error } = await supabase
    .from("listing_reviews")
    .select("*")
    .eq("id", reviewId)
    .single();

  if (error || !review) return { error: "Review not found", status: 404 };

  if (review.listing_id) {
    const { data: own } = await supabase
      .from("listing_landlords")
      .select("listing_id")
      .eq("listing_id", review.listing_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (own) return { review };
  }

  return { error: "Forbidden", status: 403 };
}

export async function PATCH(request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { reviewId, reviewedType } = await request.json();

    if (reviewedType !== "user" && reviewedType !== "listing") {
      return NextResponse.json({ error: "Invalid reviewedType" }, { status: 400 });
    }

    const { review, error, status } = await verifyReviewOwnership(reviewId, session.user.id);
    if (error) return NextResponse.json({ error }, { status });

    // Mark review as legitimate
    const { error: updateError } = await supabase
      .from("listing_reviews")
      .update({ legitimacy: true })
      .eq("id", reviewId);

    if (updateError) {
      console.error("Error updating review legitimacy:", updateError);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    // Suppress unused variable warning — review used for ownership check only here
    void review;

    return NextResponse.json({});
  } catch (error) {
    console.error("Error updating review legitimacy:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { reviewId, reviewedType } = await request.json();

    if (reviewedType !== "user" && reviewedType !== "listing") {
      return NextResponse.json({ error: "Invalid reviewedType" }, { status: 400 });
    }

    const { review, error, status } = await verifyReviewOwnership(reviewId, session.user.id);
    if (error) return NextResponse.json({ error }, { status });

    // Delete the review
    await supabase
      .from("listing_reviews")
      .delete()
      .eq("id", reviewId);

    void review;

    return NextResponse.json({});
  } catch (error) {
    console.error("Error deleting review:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
