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

    // 1️⃣ Find all listings owned by this user
    const userListings = await Listing.find({ owner: session.user.id }).select(
      "_id"
    );
    const listingIds = userListings.map((l) => l._id);

    // 2️⃣ Find reviews that are pending legitimacy
    // and are either about this user OR about one of their listings
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

export async function PATCH(request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { reviewId, reviewedType } = await request.json();

    if (reviewedType !== "user" && reviewedType !== "listing") {
      return NextResponse.json(
        { error: "Invalid reviewedType" },
        { status: 400 }
      );
    }

    await connectMongo();

    // Update the review's legitimacy to true
    const review = await Review.findByIdAndUpdate(
      reviewId,
      { legitimacy: true },
      { new: true } // return the updated document with legitimacy set to true
    );

    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    // If the review is for a listing, update the listing's rating and numReviews
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
      // If the review is for a user, update the user's rating and numReviews
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
      return NextResponse.json(
        { error: "Invalid reviewedType" },
        { status: 400 }
      );
    }

    await connectMongo();

    // Delete the review
    const review = await Review.findByIdAndDelete(reviewId);

    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    // If the review was for a listing, delete it from the listing's reviews array only (no need to update rating/numReviews cause legitimacy was false)
    if (reviewedType === "listing" && review.listing) {
      const listing = await Listing.findById(review.listing);
      if (listing) {
        listing.reviews.pull(review._id);
        await listing.save();
      }
    } else if (reviewedType === "user" && review.reviewedUser) {
      // If the review was for a user, delete it from the user's reviews array only (no need to update rating/numReviews cause legitimacy was false)
      const user = await User.findById(review.reviewedUser);
      if (user) {
        user.reviews.pull(review._id);
        await user.save();
      }
    }
    return NextResponse.json({});
  } catch (error) {
    console.error("Error updating review legitimacy:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
