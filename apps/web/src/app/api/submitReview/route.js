import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { insertAsUser } from "@/lib/supabaseWithUser";
import { isReviewEligibleEmail } from "@/lib/schools";

// Valid half-star rating: between 0.5 and 5 in 0.5 increments. Mirrors the check in
// /api/reviewReferral so both review entry points accept the same values.
function isHalfStar(v) {
  return typeof v === "number" && v >= 0.5 && v <= 5 && Number.isInteger(v * 2);
}

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!["student", "super"].includes(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!isReviewEligibleEmail(session.user.email)) {
      return NextResponse.json(
        { error: "Only students at a school we serve can leave reviews." },
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

    if (!isHalfStar(rating) || !comment || comment.trim().length < 5) {
      return NextResponse.json({ error: "Invalid rating or comment" }, { status: 400 });
    }

    if (!listingId) {
      return NextResponse.json({ error: "Must provide listingId" }, { status: 400 });
    }

    // Validate optional category ratings if provided
    for (const [key, val] of Object.entries({ communicationRating, locationRating, valueRating })) {
      if (val != null && !isHalfStar(val)) {
        return NextResponse.json(
          { error: `Invalid ${key}: must be between 0.5 and 5, in half-star steps` },
          { status: 400 }
        );
      }
    }

    const { data: newReview, error } = await insertAsUser(supabase, {
      userId: session.user.id,
      table: "listing_reviews",
      data: {
        user_id: session.user.id,
        listing_id: listingId || null,
        rating,
        comment: comment.trim(),
        legitimacy: true,
        communication_rating: communicationRating ?? null,
        location_rating: locationRating ?? null,
        value_rating: valueRating ?? null,
      },
    });

    if (error) {
      console.error("POST /api/submitReview failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json(newReview);
  } catch (e) {
    console.error("POST /api/submitReview failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
