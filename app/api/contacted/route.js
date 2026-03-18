import { auth } from "@/auth";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";

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
