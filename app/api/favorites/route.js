import { NextResponse } from "next/server";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";
import Listing from "@/models/Listing";
import mongoose from "mongoose";
import { auth } from "@/auth";

export async function POST(req) {
  try {
    const { listingId, userId } = await req.json();

    if (!listingId) {
      return NextResponse.json(
        { error: "listingId required" },
        { status: 400 }
      );
    }
    if (!mongoose.Types.ObjectId.isValid(listingId)) {
      return NextResponse.json({ error: "Invalid listingId" }, { status: 400 });
    }

    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectMongo();

    const user = await User.findById(userId).select("_id");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const removeResult = await User.updateOne(
      { _id: userId, favorites: listingId },
      { $pull: { favorites: listingId } }
    );
    if (removeResult.modifiedCount > 0) {
      await Listing.updateOne(
        { _id: listingId, numSaves: { $gt: 0 } },
        { $inc: { numSaves: -1 } }
      );
      return NextResponse.json({ favorited: false });
    }

    const addResult = await User.updateOne(
      { _id: userId, favorites: { $ne: listingId } },
      { $addToSet: { favorites: listingId } }
    );
    if (addResult.modifiedCount > 0) {
      await Listing.updateOne({ _id: listingId }, { $inc: { numSaves: 1 } });
      return NextResponse.json({ favorited: true });
    }

    return NextResponse.json({ favorited: false });
  } catch (err) {
    console.error("Toggle favorite error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
