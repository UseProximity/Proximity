import { NextResponse } from "next/server";
import supabase from "@/libs/supabase";
import { auth } from "@/auth";

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { listingId } = await req.json();
    if (!listingId || typeof listingId !== "string" || !listingId.trim()) {
      return NextResponse.json({ error: "listingId required" }, { status: 400 });
    }

    const userId = session.user.id;

    // Check if already favorited
    const { data: existing } = await supabase
      .from("user_favorites")
      .select("user_id")
      .eq("user_id", userId)
      .eq("listing_id", listingId)
      .maybeSingle();

    if (existing) {
      // Remove favorite
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

      return NextResponse.json({ favorited: false });
    } else {
      // Add favorite
      await supabase
        .from("user_favorites")
        .insert({ user_id: userId, listing_id: listingId });

      // Increment num_saves
      const { data: listing } = await supabase
        .from("listings")
        .select("num_saves")
        .eq("id", listingId)
        .single();
      if (listing) {
        await supabase
          .from("listings")
          .update({ num_saves: (listing.num_saves ?? 0) + 1 })
          .eq("id", listingId);
      }

      return NextResponse.json({ favorited: true });
    }
  } catch (err) {
    console.error("Toggle favorite error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
