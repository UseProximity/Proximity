import { NextResponse } from "next/server";
import { auth } from "@/auth";
import connectMongo from "@/libs/mongoose";
import Review from "@/models/Review";
import Listing from "@/models/Listing";
import User from "@/models/User";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectMongo();

    const userListings = await Listing.find({ owner: session.user.id }).select("_id");
    const listingIds = userListings.map((l) => l._id);

    const pendingReviews = await Review.find({
      legitimacy: false,
      $or: [
        { reviewedUser: session.user.id },
        { listing: { $in: listingIds } },
      ],
    })
      .populate("reviewer", "name image")
      .populate("reviewedUser", "name")
      .populate("listing", "address");

    return NextResponse.json(pendingReviews);
  } catch (error) {
    console.error("Error fetching pending reviews:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// Verify the current user is allowed to act on this review (owns the listing or is the reviewed user)
async function verifyReviewOwnership(reviewId, userId) {
  const review = await Review.findById(reviewId).lean();
  if (!review) return { error: "Review not found", status: 404 };

  if (review.listing) {
    const listing = await Listing.findById(review.listing).select("owner").lean();
    if (listing && String(listing.owner) === String(userId)) return { review };
  }
  if (review.reviewedUser && String(review.reviewedUser) === String(userId)) {
    return { review };
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

    await connectMongo();

    const { review, error, status } = await verifyReviewOwnership(reviewId, session.user.id);
    if (error) return NextResponse.json({ error }, { status });

    review.legitimacy = true;
    await Review.findByIdAndUpdate(reviewId, { legitimacy: true });

    if (reviewedType === "listing" && review.listing) {
      const listing = await Listing.findById(review.listing);
      if (listing) {
        listing.numReviews += 1;
        listing.rating = Math.round(
          (listing.rating * (listing.numReviews - 1) + review.rating) /
            listing.numReviews
        );
        await listing.save();
      }
    } else if (reviewedType === "user" && review.reviewedUser) {
      const user = await User.findById(review.reviewedUser);
      if (user) {
        user.numReviews += 1;
        user.rating = Math.round(
          (user.rating * (user.numReviews - 1) + review.rating) /
            user.numReviews
        );
        await user.save();
      }
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

    await connectMongo();

    const { review, error, status } = await verifyReviewOwnership(reviewId, session.user.id);
    if (error) return NextResponse.json({ error }, { status });

    await Review.findByIdAndDelete(reviewId);

    if (reviewedType === "listing" && review.listing) {
      await Listing.findByIdAndUpdate(review.listing, { $pull: { reviews: review._id } });
    } else if (reviewedType === "user" && review.reviewedUser) {
      await User.findByIdAndUpdate(review.reviewedUser, { $pull: { reviews: review._id } });
    }
    return NextResponse.json({});
  } catch (error) {
    console.error("Error deleting review:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
