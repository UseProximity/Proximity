import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { insertAsUser, deleteAsUser } from "@/lib/supabaseWithUser";
import { getRequestUser } from "@/lib/getRequestUser";
import { fetchListings } from "@/app/api/listings/route";
import { isSandboxViewer, SANDBOX_FEED_HEADERS } from "@/lib/reviewSandbox";
import { isSandboxContact } from "@/lib/contactTracking";

/**
 * @auth GET optional
 *
 * GET answers a logged-out web caller with an empty list on purpose:
 * FavoritesContext fetches on every page load, signed in or not, and the
 * response carries no user data. A Bearer header that fails to resolve still
 * gets a 401 (see below). POST stays guarded.
 */
export async function GET(req) {
  const user = await getRequestUser(req);

  // Check if this is a mobile request (has Authorization header)
  const isMobile = req.headers.get("authorization")?.startsWith("Bearer ");

  if (!user?.id) {
    // A Bearer header was present but didn't resolve to a user (missing/
    // expired/invalid access token); a real 401 so the mobile client's
    // refresh-and-retry logic (createClient.js) actually kicks in, instead
    // of this being silently indistinguishable from "genuinely 0 favorites."
    // A logged-out web request (no header at all) keeps the existing
    // graceful 200 with an empty list.
    if (isMobile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ids: [] });
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

  // Mobile needs full listing objects, so this reuses the same fetch+shape path
  // Browse/listing-detail already use (fetchListings/buildListing in
  // apps/web/src/app/api/listings/route.js) instead of a separate,
  // hand-rolled query, so favorites can't drift out of sync with the
  // real schema again. Saved-but-now-unavailable listings are excluded,
  // matching this route's previous intent.
  if (listingIds.length === 0) {
    return NextResponse.json([]);
  }

  try {
    // A review sandbox account can save the sandbox listings it sees in browse, so
    // its Saved tab carries them too. That answer is theirs alone, never cached.
    const includeSandbox = await isSandboxViewer(req);
    const listings = (await fetchListings(listingIds, { includeSandbox })).filter((l) => !l.unavailable);
    return includeSandbox
      ? NextResponse.json(listings, { headers: SANDBOX_FEED_HEADERS })
      : NextResponse.json(listings);
  } catch (err) {
    console.error("[favorites GET] fetchListings error:", err);
    return NextResponse.json({ error: "Failed to fetch favorites" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const user = await getRequestUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // `favorited` (optional boolean) is the state the caller wants, so a
    // repeated or out-of-order request cannot flip it the wrong way. Without it
    // the call toggles, which is what the mobile app sends.
    const { listingId, favorited } = await req.json();
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

    const want = typeof favorited === "boolean" ? favorited : !existing;
    // Already in the wanted state: nothing to write (and no second "saves" tick).
    if (want === !!existing) {
      return NextResponse.json({ favorited: want });
    }

    if (!want) {
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

      // Track saves metric (fire-and-forget). Not for a review sandbox account, so a
      // reviewer never inflates a real landlord's numbers.
      isSandboxContact(userId)
        .then((sandbox) => sandbox ? null : supabase.rpc("increment_listing_metric", {
          p_listing_id: listingId,
          p_metric_name: "saves",
        }))
        .then((res) => {
          if (res?.error) console.error("[metrics] favorite increment failed:", res.error.message);
        });

      return NextResponse.json({ favorited: true });
    }
  } catch (err) {
    console.error("Toggle favorite error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
