import { NextResponse } from "next/server";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";

export async function DELETE(_req, { params }) {
  const userId = "68877696221d6bb66c4c7c7d"; // FIXME: derive from auth/session
  const { listingId } = params || {};
  if (!listingId) {
    return NextResponse.json({ error: "listingId required" }, { status: 400 });
  }

  try {
    await connectMongo();
    await User.updateOne({ _id: userId }, { $pull: { favorites: listingId } });
    return NextResponse.json({ removed: true, listingId });
  } catch (err) {
    console.error("Remove favorite error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
