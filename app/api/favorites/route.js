import { NextResponse } from "next/server";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";
import Listing from "@/models/Listing";

export async function POST(req) {
  try {
    const { listingId, userId } = await req.json();

    if (!listingId) {
      return NextResponse.json(
        { error: "listingId required" },
        { status: 400 }
      );
    }
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 401 });
    }

    await connectMongo();

    const user = await User.findById(userId).select("_id favorites");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const exists = (user.favorites || []).some(
      (id) => id.toString() === listingId
    );

    if (exists) {
      await User.updateOne(
        { _id: userId },
        { $pull: { favorites: listingId } }
      );
      return NextResponse.json({ favorited: false });
    } else {
      await User.updateOne(
        { _id: userId },
        { $addToSet: { favorites: listingId } }
      );
      return NextResponse.json({ favorited: true });
    }
  } catch (err) {
    console.error("Toggle favorite error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
