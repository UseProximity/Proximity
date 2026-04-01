import { auth } from "@/auth";
import supabase from "@/libs/supabase";

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

    const { error } = await supabase
      .from("user_contacted")
      .upsert(
        { user_id: session.user.id, listing_id: listingId },
        { onConflict: "user_id,listing_id" }
      );

    if (error) {
      console.error("Error saving contacted listing:", error);
      return Response.json({ error: "Failed to save" }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error saving contacted listing:", error);
    return Response.json({ error: "Failed to save" }, { status: 500 });
  }
}
