import { NextResponse } from "next/server";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";
import Listing from "@/models/Listing";
import mongoose from "mongoose";
import { auth } from "@/auth";

export async function DELETE(_req, { params }) {
  try {
    const { listingId } = params || {};

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
    const removeResult = await User.updateOne(
      { _id: session?.user?.id, favorites: listingId },
      { $pull: { favorites: listingId } }
    );
    if (removeResult.modifiedCount > 0) {
      await Listing.updateOne(
        { _id: listingId, numSaves: { $gt: 0 } },
        { $inc: { numSaves: -1 } }
      );
    }
    return NextResponse.json({
      removed: removeResult.modifiedCount > 0,
      listingId,
    });
  } catch (err) {
    console.error("Remove favorite error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
