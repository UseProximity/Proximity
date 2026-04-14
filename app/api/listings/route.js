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
    // Listing-level fields (migrated from listing_units)
    leaseAvailability: Array.isArray(row.lease_availability) ? row.lease_availability : [],
    leaseStructure: row.lease_structure ?? null,
    homeType: row.home_type ?? "apartment",
    furnished: row.furnished ?? false,
    moveInDate: row.move_in_date ?? null,
    utilitiesIncluded: Array.isArray(row.utilities_included) ? row.utilities_included : [],
    subleaseFriendly: row.sublease_friendly ?? false,
    twentyOnePlus: row.twenty_one_plus ?? false,
    unavailable: row.unavailable ?? false,
    amenities: Array.isArray(row.amenities) ? row.amenities : [],
    // Aggregate columns (maintained by DB trigger)
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

export { buildListing };

export async function GET() {
  try {
    // landlord_id is now uuid[] — no FK join available; batch-fetch landlords separately
    const { data: listings, error } = await supabase
      .from("listings")
      .select("*, listing_units(*), reviews!listing_id(rating, legitimacy)");

    if (error) {
      console.error("Error fetching listings:", error);
      return Response.json({ error: "Failed to fetch listings" }, { status: 500 });
    }

    // Collect unique first-landlord IDs across all listings, then batch-fetch their user rows
    const firstLandlordIds = [
      ...new Set(
        (listings ?? [])
          .map((l) => (Array.isArray(l.landlord_id) ? l.landlord_id[0] : null))
          .filter(Boolean)
      ),
    ];
    let landlordMap = {};
    if (firstLandlordIds.length > 0) {
      const { data: landlordUsers } = await supabase
        .from("users")
        .select("id, name, email, image")
        .in("id", firstLandlordIds);
      for (const u of landlordUsers ?? []) landlordMap[u.id] = u;
    }

    const safeListings = (listings ?? []).map((row) => {
      const firstId = Array.isArray(row.landlord_id) ? row.landlord_id[0] : null;
      const owner = firstId ? landlordMap[firstId] ?? null : null;
      const listing = buildListing(row, row.listing_units ?? [], owner, row.reviews ?? []);
      // Compute rating from legitimate reviews (same logic as ListingModalInfo)
      const legitReviews = (row.reviews || []).filter((r) => r.legitimacy);
      listing.numReviews = legitReviews.length;
      listing.rating = legitReviews.length
        ? legitReviews.reduce((s, r) => s + r.rating, 0) / legitReviews.length
        : 0;
      return listing;
    });

    return Response.json(safeListings);
  } catch (error) {
    console.error("Error fetching listings:", error);
    return Response.json({ error: "Failed to fetch listings" }, { status: 500 });
  }
}
