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

    const { data: typeRow } = await supabase
      .from("interaction_types")
      .select("id")
      .eq("name", "saved")
      .single();
    const favoriteTypeId = typeRow?.id;

    if (!favoriteTypeId) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const { data: existing } = await supabase
      .from("user_listing_interactions")
      .select("id")
      .eq("user_id", userId)
      .eq("listing_id", listingId)
      .eq("interaction_type_id", favoriteTypeId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ removed: false, listingId });
    }

    await supabase
      .from("user_listing_interactions")
      .delete()
      .eq("user_id", userId)
      .eq("listing_id", listingId)
      .eq("interaction_type_id", favoriteTypeId);

    return NextResponse.json({ removed: true, listingId });
  } catch (err) {
    console.error("Remove favorite error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
