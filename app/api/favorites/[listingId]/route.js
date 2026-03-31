import { NextResponse } from "next/server";
import supabase from "@/libs/supabase";
import { auth } from "@/auth";

export async function DELETE(_req, { params }) {
  try {
    const { listingId } = params || {};

    if (!listingId || typeof listingId !== "string" || !listingId.trim()) {
      return NextResponse.json({ error: "listingId required" }, { status: 400 });
    }

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const { data: existing } = await supabase
      .from("user_favorites")
      .select("user_id")
      .eq("user_id", userId)
      .eq("listing_id", listingId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ removed: false, listingId });
    }

    await supabase
      .from("user_favorites")
      .delete()
      .eq("user_id", userId)
      .eq("listing_id", listingId);

    // Decrement num_saves
    const { data: listing } = await supabase
      .from("listings")
      .select("num_saves")
      .eq("id", listingId)
      .single();
    if (listing && listing.num_saves > 0) {
      await supabase
        .from("listings")
        .update({ num_saves: listing.num_saves - 1 })
        .eq("id", listingId);
    }

    return NextResponse.json({ removed: true, listingId });
  } catch (err) {
    console.error("Remove favorite error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
