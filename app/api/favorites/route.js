import { NextResponse } from "next/server";
import supabase from "@/libs/supabase";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ids: [] });

  const { data: typeRow } = await supabase
    .from("interaction_types")
    .select("id")
    .eq("name", "saved")
    .single();

  if (!typeRow) return NextResponse.json({ ids: [] });

  const { data: rows } = await supabase
    .from("user_listing_interactions")
    .select("listing_id")
    .eq("user_id", session.user.id)
    .eq("interaction_type_id", typeRow.id);

  return NextResponse.json({ ids: (rows ?? []).map((r) => r.listing_id) });
}

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

    // Look up the favorite interaction type ID
    const { data: typeRow } = await supabase
      .from("interaction_types")
      .select("id")
      .eq("name", "saved")
      .single();
    const favoriteTypeId = typeRow?.id;

    if (!favoriteTypeId) {
      return NextResponse.json({ error: "Interaction type not found" }, { status: 500 });
    }

    // Check if already favorited
    const { data: existing } = await supabase
      .from("user_listing_interactions")
      .select("listing_id")
      .eq("user_id", userId)
      .eq("listing_id", listingId)
      .eq("interaction_type_id", favoriteTypeId)
      .maybeSingle();

    if (existing) {
      // Remove favorite
      await supabase
        .from("user_listing_interactions")
        .delete()
        .eq("user_id", userId)
        .eq("listing_id", listingId)
        .eq("interaction_type_id", favoriteTypeId);

      return NextResponse.json({ favorited: false });
    } else {
      // Add favorite
      await supabase
        .from("user_listing_interactions")
        .insert({ user_id: userId, listing_id: listingId, interaction_type_id: favoriteTypeId });

      // Track saves metric (fire-and-forget)
      supabase
        .rpc("increment_listing_metric", {
          p_listing_id: listingId,
          p_metric_name: "saves",
        })
        .then(({ error: rpcErr }) => {
          if (rpcErr) console.error("[metrics] favorite increment failed:", rpcErr.message);
        });

      return NextResponse.json({ favorited: true });
    }
  } catch (err) {
    console.error("Toggle favorite error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
