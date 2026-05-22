export const dynamic = "force-dynamic"; //so Next knows it's dynamic and not static

import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { LISTING_SELECT } from "@/lib/listings/listingSelect";

function amenitiesRowToArray(row) {
  if (!row) return [];
  return [
    "air_conditioning","dishwasher","gym","laundry","mailroom","microwave",
    "oven","parking","pets_allowed","pool","refrigerator","rooftop",
    "storage","stove","study_room",
  ].filter((k) => row[k] === true);
}

function utilitiesRowToArray(row) {
  if (!row) return [];
  return ["electric","gas","heat","water","internet","trash","cable","sewer","cooling"]
    .filter((k) => row[k] === true);
}

function computeLeaseAggregates(leases) {
  const active = (leases ?? []).filter((l) => l.is_active && !l.deleted_at);
  if (!active.length) {
    return { minRent: null, maxRent: null, minBedrooms: null, maxBedrooms: null,
             minBathrooms: null, maxBathrooms: null, minArea: null, maxArea: null };
  }
  const perBedRent = (l) => {
    if (l.pricing_basis === "per_bed") return Number(l.rent);
    if (l.pricing_basis === "per_unit" && l.bedrooms > 0) return Number(l.rent) / l.bedrooms;
    return Number(l.rent);
  };
  const rents = active.map(perBedRent);
  const beds  = active.map((l) => l.bedrooms).filter((v) => v != null);
  const baths = active.map((l) => l.bathrooms).filter((v) => v != null);
  const areas = active.map((l) => l.area).filter((v) => v != null);
  return {
    minRent:      rents.length ? Math.min(...rents) : null,
    maxRent:      rents.length ? Math.max(...rents) : null,
    minBedrooms:  beds.length  ? Math.min(...beds)  : null,
    maxBedrooms:  beds.length  ? Math.max(...beds)  : null,
    minBathrooms: baths.length ? Math.min(...baths) : null,
    maxBathrooms: baths.length ? Math.max(...baths) : null,
    minArea:      areas.length ? Math.min(...areas) : null,
    maxArea:      areas.length ? Math.max(...areas) : null,
  };
}

function serializeListing(l, currentUserId = null, coOwnerMap = {}, metricsMap = {}) {
  const landlords = Array.isArray(l.listing_landlords) ? l.listing_landlords : [];
  const primaryLandlord = landlords.find((x) => x.is_primary) ?? landlords[0] ?? null;
  const owner = primaryLandlord?.user_id ?? null;

  const coOwners = landlords
    .filter((x) => x.user_id !== currentUserId)
    .map((x) => ({
      id: x.user_id,
      name: coOwnerMap[x.user_id]?.name ?? null,
      email: coOwnerMap[x.user_id]?.email ?? null,
    }));

  const legitReviews = (l.listing_reviews ?? []).filter(
    (r) => r.legitimacy && !r.deleted_at
  );
  const numReviews = legitReviews.length;
  const rating = numReviews
    ? legitReviews.reduce((s, r) => s + r.rating, 0) / numReviews
    : 0;

  return {
    _id: l.id?.toString(),
    id: l.id,
    title: l.title ?? null,
    address: l.address,
    description: l.description ?? null,
    unitTypes: (l.listing_leases ?? [])
      .filter((ll) => ll.is_active && !ll.deleted_at)
      .map((ll) => ({
        rent: ll.rent != null ? Number(ll.rent) : null,
        area: ll.area != null ? Number(ll.area) : null,
        bedrooms: ll.bedrooms != null ? Number(ll.bedrooms) : null,
        bathrooms: ll.bathrooms != null ? Number(ll.bathrooms) : null,
        pricingBasis: ll.pricing_basis,
        leaseTermMonths: ll.lease_term_months,
      })),
    leaseType: l.lease_type ?? null,
    leaseStructure: l.lease_structure ?? null,
    leaseAvailability: Array.isArray(l.lease_availability) ? l.lease_availability : [],
    moveInDate: l.move_in_date ? new Date(l.move_in_date).toISOString() : null,
    homeType: l.home_types?.label ?? null,
    amenities: amenitiesRowToArray(l.listing_amenities),
    furnished: l.furnished ?? false,
    utilitiesIncluded: utilitiesRowToArray(l.listing_utilities),
    subleaseFriendly: l.sublease_friendly ?? false,
    twentyOnePlus: l.twenty_one_plus ?? false,
    unavailable: l.unavailable ?? false,
    ...computeLeaseAggregates(l.listing_leases),
    images: (l.listing_images ?? [])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((i) => i.url),
    rating,
    numReviews,
    numClicks: metricsMap[l.id] ?? 0,
    numSaves: 0,
    contactEmail: l.contact_email ?? null,
    contactPhone: l.contact_phone ?? null,
    contactName: l.contact_name ?? null,
    owner,
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

    // Look up by email — reliable across auth provider ID differences
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("email", session.user.email)
      .single();

    if (userError || !user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const userId = user.id;

    // Fetch interaction type IDs for favorite and contacted
    const [{ data: favTypeRow }, { data: contactedTypeRow }] = await Promise.all([
      supabase.from("interaction_types").select("id").eq("name", "saved").single(),
      supabase.from("interaction_types").select("id").eq("name", "contacted").single(),
    ]);
    const favoriteTypeId = favTypeRow?.id;
    const contactedTypeId = contactedTypeRow?.id;

    // Fetch favorite and contacted listing IDs, plus own listing IDs — all in parallel
    const [
      { data: favInteractions },
      { data: contactedInteractions },
      { data: ownedRows },
    ] = await Promise.all([
      favoriteTypeId
        ? supabase
            .from("user_listing_interactions")
            .select("listing_id")
            .eq("user_id", userId)
            .eq("interaction_type_id", favoriteTypeId)
        : Promise.resolve({ data: [] }),
      contactedTypeId
        ? supabase
            .from("user_listing_interactions")
            .select("listing_id")
            .eq("user_id", userId)
            .eq("interaction_type_id", contactedTypeId)
        : Promise.resolve({ data: [] }),
      supabase
        .from("listing_landlords")
        .select("listing_id")
        .eq("user_id", userId),
    ]);

    const favoriteIds = (favInteractions ?? []).map((r) => r.listing_id);
    const contactedIds = (contactedInteractions ?? []).map((r) => r.listing_id);
    const ownedIds = (ownedRows ?? []).map((r) => r.listing_id);

    // Fetch full listing data for all three sets in parallel, plus all-time click metrics for owned listings
    const [
      { data: favListings },
      { data: contactedListings },
      { data: ownListings },
      { data: clicksMetrics },
    ] = await Promise.all([
      favoriteIds.length > 0
        ? supabase.from("listings").select(LISTING_SELECT).in("id", favoriteIds).is("deleted_at", null)
        : Promise.resolve({ data: [] }),
      contactedIds.length > 0
        ? supabase.from("listings").select(LISTING_SELECT).in("id", contactedIds).is("deleted_at", null)
        : Promise.resolve({ data: [] }),
      ownedIds.length > 0
        ? supabase.from("listings").select(LISTING_SELECT).in("id", ownedIds).is("deleted_at", null)
        : Promise.resolve({ data: [] }),
      ownedIds.length > 0
        ? supabase
            .from("listing_metrics_daily")
            .select("listing_id, metric_types(name), count")
            .in("listing_id", ownedIds)
        : Promise.resolve({ data: [] }),
    ]);

    const metricsMap = {};
    for (const m of clicksMetrics ?? []) {
      if (m.metric_types?.name === "clicks") {
        metricsMap[m.listing_id] = (metricsMap[m.listing_id] ?? 0) + m.count;
      }
    }

    // Collect all co-landlord IDs across own listings (other landlords sharing these listings)
    const coOwnerIds = new Set();
    for (const l of ownListings ?? []) {
      for (const ll of (l.listing_landlords ?? [])) {
        if (ll.user_id !== userId) coOwnerIds.add(ll.user_id);
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

    const safeFavorites = (favListings ?? []).map((l) => serializeListing(l));
    const safeFavoritesIds = safeFavorites.map((f) => f._id);

    const safeContacted = (contactedListings ?? []).map((l) => serializeListing(l));
    const safeContactedIds = safeContacted.map((l) => l._id);

    const safeListings = (ownListings ?? []).map((l) =>
      serializeListing(l, userId, coOwnerMap, metricsMap)
    );
    const listingsIds = safeListings.map((l) => l._id);

    const safeUser = {
      ...user,
      _id: user.id?.toString(),
      favorites: safeFavorites,
      favoritesIds: safeFavoritesIds,
      listings: safeListings,
      contacted: safeContacted,
      contactedIds: safeContactedIds,
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
