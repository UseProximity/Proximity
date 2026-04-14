import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!["student", "super"].includes(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!session.user.email?.endsWith("@wustl.edu")) {
      return NextResponse.json(
        { error: "Only WashU students with a @wustl.edu email can leave reviews." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const {
      rating,
      comment,
      listingId,
      communicationRating,
      locationRating,
      valueRating,
    } = body;

    if (!rating || rating < 1 || rating > 5 || !comment || comment.trim().length < 5) {
      return NextResponse.json({ error: "Invalid rating or comment" }, { status: 400 });
    }

    if (!listingId) {
      return NextResponse.json({ error: "Must provide listingId" }, { status: 400 });
    }

    // Validate optional category ratings if provided
    for (const [key, val] of Object.entries({ communicationRating, locationRating, valueRating })) {
      if (val != null && (val < 1 || val > 5)) {
        return NextResponse.json(
          { error: `Invalid ${key}: must be between 1 and 5` },
          { status: 400 }
        );
      }
    }

    const { data: newReview, error } = await supabase
      .from("reviews")
      .insert({
        user_id: session.user.id,
        listing_id: listingId || null,
        rating,
        comment: comment.trim(),
        legitimacy: true,
        communication_rating: communicationRating ?? null,
        location_rating: locationRating ?? null,
        value_rating: valueRating ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error("POST /api/submitReview failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    // Recalculate listing rating and review count immediately
    try {
      const { data: allReviews, error: fetchErr } = await supabase
        .from("reviews")
        .select("rating")
        .eq("listing_id", listingId)
        .eq("legitimacy", true);

      if (!fetchErr && allReviews) {
        const numReviews = allReviews.length;
        const avgRating =
          numReviews > 0
            ? Math.round(
                (allReviews.reduce((sum, r) => sum + r.rating, 0) / numReviews) * 10
              ) / 10
            : null;

        const { error: updateErr } = await supabase
          .from("listings")
          .update({ num_reviews: numReviews, rating: avgRating })
          .eq("id", listingId);

        if (updateErr) {
          console.error("POST /api/submitReview: failed to update listing rating:", updateErr);
        }
      }
    } catch (ratingErr) {
      console.error("POST /api/submitReview: rating recalculation error:", ratingErr);
    }

    return NextResponse.json(newReview);
  } catch (e) {
    console.error("POST /api/submitReview failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
