import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

function buildListing(row, units = [], owner = null, reviews = []) {
  const firstUnit = units[0] ?? null;
  return {
    _id: row.id,
    title: row.title ?? null,
    address: row.address,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    description: row.description,
    unitTypes: units.map((u) => ({
      rent: u.rent != null ? Number(u.rent) : null,
      area: u.area != null ? Number(u.area) : null,
      bedrooms: u.bedrooms != null ? Number(u.bedrooms) : null,
      bathrooms: u.bathrooms != null ? Number(u.bathrooms) : null,
    })),
    leaseType: row.lease_type ?? null,
    images: Array.isArray(row.images) ? row.images : [],
    numReviews: Number(row.num_reviews ?? 0),
    rating: Number(row.rating ?? 0),
    reviews,
    placeWalkMinutes: row.place_walk_minutes ?? {},
    shuttleWalkMinutes: row.shuttle_walk_minutes != null ? Number(row.shuttle_walk_minutes) : null,
    contactEmail: row.contact_email ?? null,
    contactPhone: row.contact_phone ?? null,
    contactName: row.contact_name ?? null,
    leaseAvailability: firstUnit?.lease_availability ?? null,  // stays per-unit
    leaseStructure: row.lease_structure ?? null,
    homeType: row.home_type ?? "apartment",
    furnished: row.furnished ?? false,
    moveInDate: row.move_in_date ?? null,
    utilitiesIncluded: Array.isArray(row.utilities_included) ? row.utilities_included : [],
    subleaseFriendly: row.sublease_friendly ?? false,
    twentyOnePlus: row.twenty_one_plus ?? false,
    unavailable: row.unavailable ?? false,
    amenities: Array.isArray(row.amenities) ? row.amenities : [],
    minRent: row.min_rent != null ? Number(row.min_rent) : null,
    maxRent: row.max_rent != null ? Number(row.max_rent) : null,
    minBedrooms: row.min_bedrooms != null ? Number(row.min_bedrooms) : null,
    maxBedrooms: row.max_bedrooms != null ? Number(row.max_bedrooms) : null,
    minBathrooms: row.min_bathrooms != null ? Number(row.min_bathrooms) : null,
    maxBathrooms: row.max_bathrooms != null ? Number(row.max_bathrooms) : null,
    minArea: row.min_area != null ? Number(row.min_area) : null,
    maxArea: row.max_area != null ? Number(row.max_area) : null,
    numClicks: Number(row.num_clicks ?? 0),
    numSaves: Number(row.num_saves ?? 0),
    owner: owner
      ? { _id: owner.id, name: owner.name, email: owner.email ?? null, image: owner.image ?? null }
      : null,
    createdAt: row.created_at ?? null,
  };
}

export async function GET(_req, { params }) {
  try {
    const { listingId } = await params;

    if (!listingId || typeof listingId !== "string" || !listingId.trim()) {
      return NextResponse.json({ error: "Missing listing ID" }, { status: 400 });
    }

    // Fetch listing with units (FK join on landlord_id removed — column is now uuid[])
    const { data: row, error } = await supabase
      .from("listings")
      .select("*, listing_units(*)")
      .eq("id", listingId)
      .single();

    if (error || !row) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // Fetch first landlord separately (show first in array per UX decision)
    let ownerUser = null;
    const firstLandlordId = Array.isArray(row.landlord_id) ? row.landlord_id[0] : null;
    if (firstLandlordId) {
      const { data: landlord } = await supabase
        .from("users")
        .select("id, name, email, image")
        .eq("id", firstLandlordId)
        .maybeSingle();
      ownerUser = landlord ?? null;
    }

    // Increment num_clicks (fire-and-forget)
    supabase
      .from("listings")
      .update({ num_clicks: (row.num_clicks ?? 0) + 1 })
      .eq("id", listingId)
      .then(({ error: updateErr }) => {
        if (updateErr) console.error("[clicks] num_clicks increment failed:", updateErr.message);
      });

    // Track clicks metric (fire-and-forget)
    const _today = new Date().toISOString().split("T")[0];
    supabase
      .rpc("increment_listing_metric", {
        p_listing_id: listingId,
        p_landlord_id: firstLandlordId ?? null,
        p_metric_type: "clicks",
        p_date: _today,
      })
      .then(({ error: rpcErr }) => {
        if (rpcErr) console.error("[metrics] clicks increment failed:", rpcErr.message);
      });

    // Fetch reviews with reviewer info
    const { data: reviewRows } = await supabase
      .from("reviews")
      .select("*, reviewer:users!user_id(id, name, image)")
      .eq("listing_id", listingId);

    const reviews = (reviewRows ?? []).map((r) => ({
      _id: r.id,
      rating: r.rating,
      comment: r.comment,
      legitimacy: r.legitimacy ?? false,
      communicationRating: r.communication_rating ?? null,
      locationRating: r.location_rating ?? null,
      valueRating: r.value_rating ?? null,
      createdAt: r.created_at ?? null,
      upvotes: Array.isArray(r.upvotes) ? r.upvotes : [],
      downvotes: Array.isArray(r.downvotes) ? r.downvotes : [],
      reviewer: r.reviewer
        ? { _id: r.reviewer.id, name: r.reviewer.name, image: r.reviewer.image ?? null }
        : r.name ? { _id: null, name: r.name, image: null } : null,
    }));

    const safeListing = buildListing(row, row.listing_units ?? [], ownerUser, reviews);

    return NextResponse.json(safeListing);
  } catch (error) {
    console.error("Error fetching listing:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

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

    const { data: row, error: fetchError } = await supabase
      .from("listings")
      .select("id, landlord_id")
      .eq("id", listingId)
      .single();

    if (fetchError || !row) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (!(row.landlord_id ?? []).includes(session.user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { unavailable } = await req.json();
    if (typeof unavailable !== "boolean") {
      return NextResponse.json({ error: "Invalid value for unavailable" }, { status: 400 });
    }

    // unavailable is now a listing-level field
    const { error: updateError } = await supabase
      .from("listings")
      .update({ unavailable })
      .eq("id", listingId);

    if (updateError) {
      return NextResponse.json({ error: "Failed to update listing" }, { status: 500 });
    }

    return NextResponse.json({ success: true, unavailable });
  } catch (error) {
    console.error("Error updating listing:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
