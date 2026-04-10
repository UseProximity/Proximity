import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get listing IDs owned by this user
    const { data: userListings } = await supabase
      .from("listings")
      .select("id")
      .contains("landlord_id", [session.user.id]);

    const listingIds = (userListings || []).map((l) => l.id);

    // Fetch pending reviews for those listings
    let pendingReviews = [];
    if (listingIds.length > 0) {
      const { data: reviews, error } = await supabase
        .from("reviews")
        .select("*, reviewer:users!reviews_user_id_fkey(name, image), listings(address)")
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
    .from("reviews")
    .select("*")
    .eq("id", reviewId)
    .single();

  if (error || !review) return { error: "Review not found", status: 404 };

  if (review.listing_id) {
    const { data: listing } = await supabase
      .from("listings")
      .select("landlord_id")
      .eq("id", review.listing_id)
      .single();
    if (listing && (listing.landlord_id ?? []).includes(userId)) return { review };
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
      .from("reviews")
      .update({ legitimacy: true })
      .eq("id", reviewId);

    if (updateError) {
      console.error("Error updating review legitimacy:", updateError);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    if (reviewedType === "listing" && review.listing_id) {
      // Recalculate listing stats from all legitimate reviews
      const { data: allReviews } = await supabase
        .from("reviews")
        .select("rating")
        .eq("listing_id", review.listing_id)
        .eq("legitimacy", true);

      const reviews = allReviews || [];
      const numReviews = reviews.length;
      const rating = numReviews > 0
        ? Math.round(reviews.reduce((sum, r) => sum + r.rating, 0) / numReviews)
        : 0;

      await supabase
        .from("listings")
        .update({ num_reviews: numReviews, rating })
        .eq("id", review.listing_id);
    }

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
      .from("reviews")
      .delete()
      .eq("id", reviewId);

    if (reviewedType === "listing" && review.listing_id) {
      // Recalculate listing stats from remaining legitimate reviews
      const { data: allReviews } = await supabase
        .from("reviews")
        .select("rating")
        .eq("listing_id", review.listing_id)
        .eq("legitimacy", true);

      const reviews = allReviews || [];
      const numReviews = reviews.length;
      const rating = numReviews > 0
        ? Math.round(reviews.reduce((sum, r) => sum + r.rating, 0) / numReviews)
        : 0;

      await supabase
        .from("listings")
        .update({ num_reviews: numReviews, rating })
        .eq("id", review.listing_id);
    }

    return NextResponse.json({});
  } catch (error) {
    console.error("Error deleting review:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
