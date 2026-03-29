import { auth } from "@/auth";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";
import mongoose from "mongoose";

// POST /api/contacted — add a listing to the user's contacted list (idempotent)
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { listingId } = await req.json();
    if (!listingId) {
      return Response.json({ error: "listingId required" }, { status: 400 });
    }
    if (!mongoose.Types.ObjectId.isValid(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }

    await connectMongo();

    await User.findByIdAndUpdate(session.user.id, {
      $addToSet: { contacted: listingId },
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error saving contacted listing:", error);
    return Response.json({ error: "Failed to save" }, { status: 500 });
  }
}
