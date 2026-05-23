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
 *   - home_types(label): single nested object
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
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function amenitiesRowToArray(row) {
  if (!row) return [];
  return [
    "air_conditioning",
    "dishwasher",
    "gym",
    "laundry",
    "mailroom",
    "microwave",
    "oven",
    "parking",
    "pets_allowed",
    "pool",
    "refrigerator",
    "rooftop",
    "storage",
    "stove",
    "study_room",
  ].filter((k) => row[k] === true);
}

function utilitiesRowToArray(row) {
  if (!row) return [];
  return [
    "electric",
    "gas",
    "heat",
    "water",
    "internet",
    "trash",
    "cable",
    "sewer",
    "cooling",
  ].filter((k) => row[k] === true);
}

/**
 * Convert walk-time rows to a plain { locationName: minutes } map.
 * 'shuttle_nearest' is excluded here — appears on shuttleWalkMinutes instead.
 */
function walkTimesToMap(walkTimes) {
  const map = {};
  for (const wt of walkTimes ?? []) {
    const name = wt.locations?.name;
    if (name && name !== "shuttle_nearest") map[name] = wt.minutes;
  }
  return map;
}

// ---------------------------------------------------------------------------
// buildListing — inline (includes reviews with votes + full walk times)
// ---------------------------------------------------------------------------

function buildListing(row, owner = null, reviews = []) {
  const walkTimes = row.listing_walk_times ?? [];
  const shuttle = walkTimes.find((wt) => wt.locations?.name === "shuttle_nearest");

  // Compute rating from passed-in reviews (already filtered to legit + not deleted)
  const legitReviews = reviews.filter((r) => r.legitimacy && !r.deletedAt);

  return {
    _id: row.id,
    title: row.title ?? null,
    address: row.address,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    description: row.description,
    unitTypes: (row.listing_units ?? []).map((u) => {
      const activeRent = (u.unit_leases ?? []).find((l) => l.is_active)?.rent;
      const nextAvailable = (u.unit_leases ?? [])
        .filter((l) => l.available_from)
        .sort((a, b) => new Date(a.available_from) - new Date(b.available_from))[0]
        ?.available_from ?? null;
      return {
        rent: activeRent != null ? Number(activeRent) : null,
        area: u.area != null ? Number(u.area) : null,
        bedrooms: u.bedrooms != null ? Number(u.bedrooms) : null,
        bathrooms: u.bathrooms != null ? Number(u.bathrooms) : null,
        leaseAvailability: nextAvailable,
        available: u.available ?? true,
      };
    }),
    leaseType: (row.listing_units ?? []).some((u) =>
      (u.unit_leases ?? []).some((l) => l.is_active && l.sublease)
    ) ? "Sublease" : "Standard",
    images: (row.listing_images ?? [])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((img) => img.url),
    numReviews: legitReviews.length,
    rating:
      legitReviews.length
        ? Math.round(
            (legitReviews.reduce((s, r) => s + r.rating, 0) / legitReviews.length) * 10
          ) / 10
        : 0,
    reviews,
    placeWalkMinutes: walkTimesToMap(walkTimes),
    shuttleWalkMinutes: shuttle ? shuttle.minutes : null,
    contactEmail: row.contact_email ?? null,
    contactPhone: row.contact_phone ?? null,
    contactName: row.contact_name ?? null,
    leaseAvailability: [],
    leaseStructure: row.lease_structure ?? null,
    homeType: row.home_types?.label ?? "Other",
    furnished: row.furnished ?? false,
    moveInDate: row.move_in_date ?? null,
    utilitiesIncluded: utilitiesRowToArray(row.listing_utilities),
    subleaseFriendly: row.sublease_friendly ?? false,
    twentyOnePlus: row.twenty_one_plus ?? false,
    unavailable: (() => {
      if (row.unavailable) return true;
      const units = row.listing_units ?? [];
      return units.length > 0 && units.every((u) => u.available === false);
    })(),
    amenities: amenitiesRowToArray(row.listing_amenities),
    minRent: row.min_rent != null ? Number(row.min_rent) : null,
    maxRent: row.max_rent != null ? Number(row.max_rent) : null,
    minBedrooms: row.min_bedrooms != null ? Number(row.min_bedrooms) : null,
    maxBedrooms: row.max_bedrooms != null ? Number(row.max_bedrooms) : null,
    minBathrooms: row.min_bathrooms != null ? Number(row.min_bathrooms) : null,
    maxBathrooms: row.max_bathrooms != null ? Number(row.max_bathrooms) : null,
    minArea: row.min_area != null ? Number(row.min_area) : null,
    maxArea: row.max_area != null ? Number(row.max_area) : null,
    // Dropped in v4 — return safe defaults
    numClicks: 0,
    numSaves: 0,
    owner: owner
      ? {
          _id: owner.id,
          name: owner.name,
          email: owner.email ?? null,
          image: owner.image ?? null,
        }
      : null,
    createdAt: row.created_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/listing/[listingId]
// ---------------------------------------------------------------------------

export async function GET(req, { params }) {
  try {
    const { listingId } = await params;
    const session = await auth().catch(() => null);
    const currentUserId = session?.user?.id ?? null;

    if (!listingId || typeof listingId !== "string" || !listingId.trim()) {
      return NextResponse.json({ error: "Missing listing ID" }, { status: 400 });
    }

    // Fetch listing with all v4 related tables
    const { data: row, error } = await supabase
      .from("listings")
      .select(
        `
        id, title, address, longitude, latitude, description,
        lease_type, contact_email, contact_phone, contact_name,
        lease_structure, furnished, move_in_date,
        sublease_friendly, twenty_one_plus, unavailable,
        city, state, zipcode, created_at,
        min_rent, max_rent, min_bedrooms, max_bedrooms,
        min_bathrooms, max_bathrooms, min_area, max_area,
        home_types(label),
        listing_units(
          id, bedrooms, bathrooms, area, available,
          unit_leases(rent, is_active, available_from, sublease)
        ),
        listing_landlords(user_id, is_primary),
        listing_amenities(
          air_conditioning, dishwasher, gym, laundry, mailroom, microwave,
          oven, parking, pets_allowed, pool, refrigerator, rooftop,
          storage, stove, study_room
        ),
        listing_utilities(
          electric, gas, heat, water, internet, trash, cable, sewer, cooling
        ),
        listing_images(url, sort_order),
        listing_walk_times(minutes, locations(name))
        `
      )
      .eq("id", listingId)
      .single();

    if (error || !row) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // Resolve primary landlord from listing_landlords
    const ll = row.listing_landlords ?? [];
    const primaryLandlord = ll.find((x) => x.is_primary) ?? ll[0] ?? null;

    let ownerUser = null;
    if (primaryLandlord?.user_id) {
      const { data: landlord, error: landlordErr } = await supabase
        .from("users")
        .select("id, name, email, image")
        .eq("id", primaryLandlord.user_id)
        .maybeSingle();
      if (landlordErr) {
        console.error("[listing GET] landlord fetch error:", landlordErr);
      }
      ownerUser = landlord ?? null;
    }

    // Track view metric via RPC — fire-and-forget with new v4 signature
    supabase
      .rpc("increment_listing_metric", {
        p_listing_id: listingId,
        p_metric_name: "clicks",
      })
      .then(({ error: rpcErr }) => {
        if (rpcErr) console.error("[listing GET] increment_listing_metric failed:", rpcErr.message);
      });

    // Fetch reviews from listing_reviews (renamed from reviews in v4)
    // Show all reviews (including illegitimate) so the UI can mark them;
    // only legit + not-deleted count toward the rating (handled in buildListing)
    const { data: reviewRows, error: reviewErr } = await supabase
      .from("listing_reviews")
      .select("id, rating, comment, legitimacy, communication_rating, location_rating, value_rating, created_at, deleted_at, user_id, name")
      .eq("listing_id", listingId)
      .is("deleted_at", null);

    if (reviewErr) {
      console.error("[listing GET] reviews fetch error:", reviewErr);
    }

    // Batch-fetch reviewer profiles
    const reviewerIds = [...new Set((reviewRows ?? []).map((r) => r.user_id).filter(Boolean))];
    let reviewerMap = {};
    if (reviewerIds.length > 0) {
      const { data: reviewerUsers, error: reviewerErr } = await supabase
        .from("users")
        .select("id, name, image")
        .in("id", reviewerIds);
      if (reviewerErr) {
        console.error("[listing GET] reviewer batch fetch error:", reviewerErr);
      }
      for (const u of reviewerUsers ?? []) reviewerMap[u.id] = u;
    }

    // Fetch vote counts from review_votes (replaced upvotes/downvotes arrays)
    const reviewIds = (reviewRows ?? []).map((r) => r.id);
    let votesByReview = {};
    if (reviewIds.length > 0) {
      const { data: voteRows, error: voteErr } = await supabase
        .from("review_votes")
        .select("review_id, vote, user_id")
        .in("review_id", reviewIds);
      if (voteErr) {
        console.error("[listing GET] vote fetch error:", voteErr);
      }
      for (const v of voteRows ?? []) {
        if (!votesByReview[v.review_id]) votesByReview[v.review_id] = { up: 0, down: 0, userVote: null };
        if (v.vote === "up") votesByReview[v.review_id].up += 1;
        else if (v.vote === "down") votesByReview[v.review_id].down += 1;
        if (currentUserId && v.user_id === currentUserId) votesByReview[v.review_id].userVote = v.vote;
      }
    }

    const reviews = (reviewRows ?? []).map((r) => {
      const reviewer = r.user_id ? reviewerMap[r.user_id] : null;
      const votes = votesByReview[r.id] ?? { up: 0, down: 0, userVote: null };
      return {
        _id: r.id,
        rating: r.rating,
        comment: r.comment,
        legitimacy: r.legitimacy ?? false,
        communicationRating: r.communication_rating ?? null,
        locationRating: r.location_rating ?? null,
        valueRating: r.value_rating ?? null,
        createdAt: r.created_at ?? null,
        deletedAt: r.deleted_at ?? null,
        upvotes: votes.up,
        downvotes: votes.down,
        userVote: votes.userVote,
        reviewer: reviewer
          ? { _id: reviewer.id, name: reviewer.name, image: reviewer.image ?? null }
          : r.name
          ? { _id: null, name: r.name, image: null }
          : null,
      };
    });

    const safeListing = buildListing(row, ownerUser, reviews);

    return NextResponse.json(safeListing);
  } catch (err) {
    console.error("[listing GET] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
      return NextResponse.json({ error: "Missing listing ID" }, { status: 400 });
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
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!landlordRow) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { unavailable } = await req.json();
    if (typeof unavailable !== "boolean") {
      return NextResponse.json({ error: "Invalid value for unavailable" }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from("listings")
      .update({ unavailable })
      .eq("id", listingId);

    if (updateError) {
      console.error("[listing PATCH] update error:", updateError);
      return NextResponse.json({ error: "Failed to update listing" }, { status: 500 });
    }

    return NextResponse.json({ success: true, unavailable });
  } catch (err) {
    console.error("[listing PATCH] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
