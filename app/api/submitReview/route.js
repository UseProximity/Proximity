import { NextResponse } from "next/server";
import { auth } from "@/auth";
import connectMongo from "@/libs/mongoose";
import Review from "@/models/Review";
import User from "@/models/User";
import Listing from "@/models/Listing";
import mongoose from "mongoose";

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      rating,
      comment,
      reviewedUserId,
      listingId,
      communicationRating,
      locationRating,
      valueRating,
    } = body;

    if (!rating || rating < 1 || rating > 5 || !comment || comment.trim().length < 5) {
      return NextResponse.json({ error: "Invalid rating or comment" }, { status: 400 });
    }

    if (!reviewedUserId && !listingId) {
      return NextResponse.json({ error: "Must provide reviewedUserId or listingId" }, { status: 400 });
    }
    if (reviewedUserId && !mongoose.Types.ObjectId.isValid(reviewedUserId)) {
      return NextResponse.json({ error: "Invalid reviewedUserId" }, { status: 400 });
    }
    if (listingId && !mongoose.Types.ObjectId.isValid(listingId)) {
      return NextResponse.json({ error: "Invalid listingId" }, { status: 400 });
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

    await connectMongo();

    const newReview = new Review({
      reviewer: session.user.id,
      reviewedUser: reviewedUserId || null,
      listing: listingId || null,
      rating,
      comment: comment.trim(),
      legitimacy: false,
      communicationRating: communicationRating ?? null,
      locationRating: locationRating ?? null,
      valueRating: valueRating ?? null,
    });

    await newReview.save();

    if (reviewedUserId) {
      await User.updateOne({ _id: reviewedUserId }, { $push: { reviews: newReview._id } });
    }
    if (listingId) {
      await Listing.updateOne({ _id: listingId }, { $push: { reviews: newReview._id } });
    }

    return NextResponse.json(newReview);
  } catch (e) {
    console.error("POST /api/submitReview failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
