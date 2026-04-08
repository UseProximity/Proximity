export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import supabase from "@/libs/supabase";

function serializeListing(l) {
  const legitReviews = (l.reviews || []).filter((r) => r.legitimacy);
  return {
    _id: l.id?.toString(),
    id: l.id,
    title: l.title ?? null,
    address: l.address,
    description: l.description ?? null,
    unitTypes: Array.isArray(l.listing_units) ? l.listing_units : [],
    leaseType: l.lease_type ?? null,
    homeType: l.home_type,
    amenities: Array.isArray(l.amenities) ? l.amenities : [],
    furnished: l.furnished ?? false,
    utilitiesIncluded: Array.isArray(l.utilities_included) ? l.utilities_included : [],
    unavailable: l.unavailable ?? false,
    minRent: l.min_rent,
    maxRent: l.max_rent,
    minBedrooms: l.min_bedrooms,
    maxBedrooms: l.max_bedrooms,
    images: Array.isArray(l.images) ? l.images : [],
    numClicks: Number(l.num_clicks ?? 0),
    numSaves: Number(l.num_saves ?? 0),
    numReviews: legitReviews.length,
    rating: legitReviews.length
      ? legitReviews.reduce((s, r) => s + r.rating, 0) / legitReviews.length
      : 0,
    owner: l.landlord_id?.toString?.() || null,
    latitude: l.latitude,
    longitude: l.longitude,
    createdAt: l.created_at ? new Date(l.created_at).toISOString() : null,
  };
}

export async function GET(req) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify requesting user is a super
    const { data: reqUser } = await supabase
      .from("users")
      .select("role")
      .eq("email", session.user.email)
      .single();

    if (reqUser?.role !== "super") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const targetId = searchParams.get("id");
    if (!targetId) {
      return Response.json({ error: "Missing id" }, { status: 400 });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", targetId)
      .single();

    if (userError || !user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const userId = user.id;

    const [favoritesRows, ownListings, contactedRows] = await Promise.all([
      supabase.from("user_favorites").select("listings(*)").eq("user_id", userId),
      supabase.from("listings").select("*, listing_units(*), reviews!listing_id(rating, legitimacy)").eq("landlord_id", userId),
      supabase.from("user_contacted").select("listings(*)").eq("user_id", userId),
    ]);

    const favoritesListings = (favoritesRows.data || []).map((r) => r.listings).filter(Boolean);
    const contactedListings = (contactedRows.data || []).map((r) => r.listings).filter(Boolean);

    const safeFavorites = favoritesListings.map(serializeListing);
    const safeListings = (ownListings.data || []).map(serializeListing);
    const safeContacted = contactedListings.map(serializeListing);

    return Response.json({
      ...user,
      _id: user.id?.toString(),
      favorites: safeFavorites,
      favoritesIds: safeFavorites.map((f) => f._id),
      listings: safeListings,
      contacted: safeContacted,
      contactedIds: safeContacted.map((l) => l._id),
      listingsIds: safeListings.map((l) => l._id),
      createdAt: user.created_at ? new Date(user.created_at).toISOString() : null,
      updatedAt: user.updated_at ? new Date(user.updated_at).toISOString() : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/admin/viewUser failed:", error);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
