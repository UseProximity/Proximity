export const dynamic = "force-dynamic"; //so Next knows it's dynamic and not static

import { auth } from "@/auth";
import supabase from "@/libs/supabase";

function serializeListing(l, currentUserId = null, coOwnerMap = {}) {
  const ownerIds = Array.isArray(l.landlord_id) ? l.landlord_id : [];
  const coOwners = ownerIds
    .filter((id) => id !== currentUserId)
    .map((id) => ({ id, name: coOwnerMap[id]?.name ?? null, email: coOwnerMap[id]?.email ?? null }));
  return {
    _id: l.id?.toString(),
    id: l.id,
    title: l.title ?? null,
    address: l.address,
    description: l.description ?? null,
    unitTypes: Array.isArray(l.listing_units) ? l.listing_units : [],
    leaseType: l.lease_type ?? null,
    leaseStructure: l.lease_structure ?? null,
    moveInDate: l.move_in_date ? new Date(l.move_in_date).toISOString() : null,
    homeType: l.home_type,
    amenities: Array.isArray(l.amenities) ? l.amenities : [],
    furnished: l.furnished ?? false,
    utilitiesIncluded: Array.isArray(l.utilities_included) ? l.utilities_included : [],
    subleaseFriendly: l.sublease_friendly ?? false,
    unavailable: l.unavailable ?? false,
    minRent: l.min_rent,
    maxRent: l.max_rent,
    minBathrooms: l.min_bathrooms,
    maxBathrooms: l.max_bathrooms,
    minBedrooms: l.min_bedrooms,
    maxBedrooms: l.max_bedrooms,
    minArea: l.min_area,
    maxArea: l.max_area,
    images: Array.isArray(l.images) ? l.images : [],
    rating: l.rating ?? 0,
    numReviews: l.num_reviews ?? 0,
    numClicks: l.num_clicks ?? 0,
    numSaves: l.num_saves ?? 0,
    contactEmail: l.contact_email ?? null,
    contactPhone: l.contact_phone ?? null,
    contactName: l.contact_name ?? null,
    owner: ownerIds[0] ?? null,
    coOwners,
    latitude: l.latitude,
    longitude: l.longitude,
    createdAt: l.created_at ? new Date(l.created_at).toISOString() : null,
  };
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Look up by email — reliable across MongoDB↔Supabase ID format differences
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("email", session.user.email)
      .single();

    if (userError || !user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const userId = user.id;

    // Fetch favorites via user_favorites join → listings
    const { data: favoritesRows } = await supabase
      .from("user_favorites")
      .select("listings(*)")
      .eq("user_id", userId);

    const favoritesListings = (favoritesRows || [])
      .map((r) => r.listings)
      .filter(Boolean);

    // Fetch user's own listings with units
    const { data: ownListings } = await supabase
      .from("listings")
      .select("*, listing_units(*)")
      .contains("landlord_id", [userId]);

    // Collect all unique co-landlord IDs (other landlords sharing these listings)
    const coOwnerIds = new Set();
    for (const l of ownListings ?? []) {
      for (const lid of (Array.isArray(l.landlord_id) ? l.landlord_id : [])) {
        if (lid !== userId) coOwnerIds.add(lid);
      }
    }
    let coOwnerMap = {};
    if (coOwnerIds.size > 0) {
      const { data: coOwnerUsers } = await supabase
        .from("users")
        .select("id, name, email")
        .in("id", [...coOwnerIds]);
      for (const u of coOwnerUsers ?? []) coOwnerMap[u.id] = u;
    }

    // Fetch contacted listings via user_contacted join → listings
    const { data: contactedRows } = await supabase
      .from("user_contacted")
      .select("listings(*)")
      .eq("user_id", userId);

    const contactedListings = (contactedRows || [])
      .map((r) => r.listings)
      .filter(Boolean);

    const safeFavorites = favoritesListings.map(serializeListing);
    const favoritesIds = safeFavorites.map((f) => f._id);

    const safeListings = (ownListings || []).map((l) => serializeListing(l, userId, coOwnerMap));
    const listingsIds = safeListings.map((l) => l._id);

    const safeContacted = contactedListings.map(serializeListing);
    const contactedIds = safeContacted.map((l) => l._id);

    const safeUser = {
      ...user,
      _id: user.id?.toString(),
      favorites: safeFavorites,
      favoritesIds,
      listings: safeListings,
      contacted: safeContacted,
      contactedIds,
      listingsIds,
      createdAt: user.created_at ? new Date(user.created_at).toISOString() : null,
      updatedAt: user.updated_at ? new Date(user.updated_at).toISOString() : null,
    };

    return Response.json(safeUser, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return Response.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}
