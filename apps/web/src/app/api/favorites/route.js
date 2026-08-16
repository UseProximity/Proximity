import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { insertAsUser, deleteAsUser } from "@/lib/supabaseWithUser";
import { getRequestUser } from "@/lib/getRequestUser";

export async function GET(req) {
  const user = await getRequestUser(req);
  
  // Check if this is a mobile request (has Authorization header)
  const isMobile = req.headers.get("authorization")?.startsWith("Bearer ");

  if (!user?.id) {
    return NextResponse.json(isMobile ? [] : { ids: [] });
  }

  const { data: typeRow } = await supabase
    .from("interaction_types")
    .select("id")
    .eq("name", "saved")
    .single();

  if (!typeRow) {
    return NextResponse.json(isMobile ? [] : { ids: [] });
  }

  // Get all saved listing IDs
  const { data: interactions } = await supabase
    .from("user_listing_interactions")
    .select("listing_id")
    .eq("user_id", user.id)
    .eq("interaction_type_id", typeRow.id);

  const listingIds = (interactions ?? []).map((r) => r.listing_id);

  // Web only needs IDs
  if (!isMobile) {
    return NextResponse.json({ ids: listingIds });
  }

  // Mobile needs full listing objects
  if (listingIds.length === 0) {
    return NextResponse.json([]);
  }

  const { data: listings } = await supabase
    .from("listings")
    .select(`
      *,
      owner:users!owner_id(id, name, email),
      unit_types(*)
    `)
    .in("_id", listingIds)
    .eq("unavailable", false);

  // Transform to match mobile expectations
  const formatted = (listings ?? []).map((listing) => ({
    ...listing,
    unitTypes: listing.unit_types || [],
    images: listing.images || [],
    owner: listing.owner || null,
  }));

  return NextResponse.json(formatted);
}

export async function POST(req) {
  try {
    const user = await getRequestUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { listingId } = await req.json();
    if (!listingId || typeof listingId !== "string" || !listingId.trim()) {
      return NextResponse.json({ error: "listingId required" }, { status: 400 });
    }

    const userId = user.id;

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
      await deleteAsUser(supabase, {
        userId,
        table: "user_listing_interactions",
        match: { user_id: userId, listing_id: listingId, interaction_type_id: favoriteTypeId },
      });

      return NextResponse.json({ favorited: false });
    } else {
      // Add favorite
      await insertAsUser(supabase, {
        userId,
        table: "user_listing_interactions",
        data: { user_id: userId, listing_id: listingId, interaction_type_id: favoriteTypeId },
      });

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
