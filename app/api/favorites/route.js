import { NextResponse } from "next/server";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";

export async function GET(req) {
  try {
    await connectMongo();

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId parameter" },
        { status: 400 }
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      favorites: user.favorites.map((id) => id.toString()),
    });
  } catch (error) {
    console.error("Error fetching favorites:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    await connectMongo();

    const { userId, listingId, action } = await req.json();

    if (!userId || !listingId || !action) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (action === "add") {
      // Add to favorites if not already there
      if (!user.favorites.includes(listingId)) {
        user.favorites.push(listingId);
        await user.save();
      }
    } else if (action === "remove") {
      // Remove from favorites
      user.favorites = user.favorites.filter(
        (id) => id.toString() !== listingId
      );
      await user.save();
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'add' or 'remove'" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: `Listing ${
        action === "add" ? "added to" : "removed from"
      } favorites`,
      favorites: user.favorites,
    });
  } catch (error) {
    console.error("Error updating favorites:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
