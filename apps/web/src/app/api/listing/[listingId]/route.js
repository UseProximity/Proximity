/*
 * v4 schema rewrite — 2026-04-17
 * Changes from v3:
 *
 * GET handler:
 *   - select() rewritten: removed "*, listing_units(*)" — uses explicit v4 joins
 *   - listing_units now nests unit_leases(rent, is_active, available_from) for per-unit rent
 *   - Removed row.landlord_id[0] — ownership now via listing_landlords(user_id, is_primary)
 *   - listing_amenities / listing_utilities: PK on listing_id → single object, handled by helpers
 *   - listing_walk_times(minutes, locations(name)): shuttle_nearest split off to shuttleWalkMinutes
 *   - listing_images(url, sort_order): sorted, mapped to URL strings
 *   - Removed: num_clicks update (column dropped), old increment_listing_metric signature
 *   - increment_listing_metric new signature: (p_listing_id, p_metric_name)
 *   - reviews: from "listing_reviews" (renamed from "reviews"); upvotes/downvotes columns dropped
 *   - Vote counts fetched from review_votes table: select(review_id, vote).in(review_id, [...])
 *   - buildListing: uses v4 fields (home_types?.label, amenitiesRowToArray, utilitiesRowToArray, etc.)
 *   - listing_reviews filtered: deleted_at IS NULL + legitimacy = true for rating; all shown in list
 *
 * PATCH handler:
 *   - Removed select("id, landlord_id") + landlord_id.includes() ownership check
 *   - Ownership now checked via listing_landlords table:
 *     query listing_landlords where listing_id = listingId AND user_id = session.user.id
 *
 * The GET data path (select, landlord resolution, reviews, votes, buildListing)
 * lives in @/lib/listings/getListing so the /listings/[id] page renders the same
 * data server-side for metadata/JSON-LD. The click-metric RPC stays here — only
 * real API hits from the listing UI count, never crawler page renders.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getListing } from "@/lib/listings/getListing";

// ---------------------------------------------------------------------------
// GET /api/listing/[listingId]
// ---------------------------------------------------------------------------

export async function GET(req, { params }) {
  try {
    const { listingId } = await params;
    const session = await auth().catch(() => null);
    const currentUserId = session?.user?.id ?? null;

    if (!listingId || typeof listingId !== "string" || !listingId.trim()) {
      return NextResponse.json(
        { error: "Missing listing ID" },
        { status: 400 }
      );
    }

    const safeListing = await getListing(listingId, currentUserId);

    if (!safeListing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // Track view metric via RPC — fire-and-forget with new v4 signature
    supabase
      .rpc("increment_listing_metric", {
        p_listing_id: listingId,
        p_metric_name: "clicks",
      })
      .then(({ error: rpcErr }) => {
        if (rpcErr)
          console.error(
            "[listing GET] increment_listing_metric failed:",
            rpcErr.message
          );
      });

    return NextResponse.json(safeListing);
  } catch (err) {
    console.error("[listing GET] unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/listing/[listingId]
// ---------------------------------------------------------------------------

export async function PATCH(req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { listingId } = await params;
    if (!listingId || typeof listingId !== "string" || !listingId.trim()) {
      return NextResponse.json(
        { error: "Missing listing ID" },
        { status: 400 }
      );
    }

    // Verify listing exists
    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id")
      .eq("id", listingId)
      .single();

    if (listingErr || !listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // Ownership check via listing_landlords (landlord_id[] dropped in v4)
    const { data: landlordRow, error: ownershipErr } = await supabase
      .from("listing_landlords")
      .select("user_id")
      .eq("listing_id", listingId)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (ownershipErr) {
      console.error("[listing PATCH] ownership check error:", ownershipErr);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }

    if (!landlordRow) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { unavailable } = await req.json();
    if (typeof unavailable !== "boolean") {
      return NextResponse.json(
        { error: "Invalid value for unavailable" },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabase
      .from("listings")
      .update({ unavailable })
      .eq("id", listingId);

    if (updateError) {
      console.error("[listing PATCH] update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update listing" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, unavailable });
  } catch (err) {
    console.error("[listing PATCH] unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
