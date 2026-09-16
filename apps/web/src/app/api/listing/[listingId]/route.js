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

/*
 * There is deliberately no PATCH here any more.
 *
 * It existed for one caller: a "Mark Unavailable" switch on the landlord
 * dashboard that set listings.unavailable by hand. Availability is not a
 * property-level fact. A building is on the market when something in it is
 * actually for rent, so it is the offerings that decide, and each offering is
 * withdrawn and published by the landlord who owns it (DELETE and PATCH on
 * /api/leases/[leaseId]). Two levers for one question is how a property came to
 * read "Available" on the dashboard while browse had hidden it.
 *
 * listings.unavailable survives as a SYSTEM hide, written by the availability
 * check-in replies and the auto-unavailable cron, and cleared when a landlord
 * claims an auto-created stub. No landlord-facing route sets it.
 */
