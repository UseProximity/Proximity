export const dynamic = "force-dynamic"; //so Next knows it's dynamic and not static

import { auth } from "@/auth";
import supabase from "@/libs/supabase";

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
    unitTypes: (l.listing_units ?? []).map((u) => {
      const activeRent = (u.unit_leases ?? []).find((lease) => lease.is_active)?.rent;
      return {
        rent: activeRent != null ? Number(activeRent) : null,
        area: u.area != null ? Number(u.area) : null,
        bedrooms: u.bedrooms != null ? Number(u.bedrooms) : null,
        bathrooms: u.bathrooms != null ? Number(u.bathrooms) : null,
      };
    }),
    leaseType: l.lease_type ?? null,
    leaseStructure: l.lease_structure ?? null,
    moveInDate: l.move_in_date ? new Date(l.move_in_date).toISOString() : null,
    homeType: l.home_types?.label ?? null,
    amenities: amenitiesRowToArray(l.listing_amenities),
    furnished: l.furnished ?? false,
    utilitiesIncluded: utilitiesRowToArray(l.listing_utilities),
    subleaseFriendly: l.sublease_friendly ?? false,
    unavailable: l.unavailable ?? false,
    minRent: l.min_rent != null ? Number(l.min_rent) : null,
    maxRent: l.max_rent != null ? Number(l.max_rent) : null,
    minBathrooms: l.min_bathrooms != null ? Number(l.min_bathrooms) : null,
    maxBathrooms: l.max_bathrooms != null ? Number(l.max_bathrooms) : null,
    minBedrooms: l.min_bedrooms != null ? Number(l.min_bedrooms) : null,
    maxBedrooms: l.max_bedrooms != null ? Number(l.max_bedrooms) : null,
    minArea: l.min_area != null ? Number(l.min_area) : null,
    maxArea: l.max_area != null ? Number(l.max_area) : null,
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

const LISTING_SELECT = `
  id, title, address, longitude, latitude, description,
  lease_type, contact_email, contact_phone, contact_name,
  lease_structure, furnished, move_in_date, sublease_friendly,
  unavailable, created_at,
  min_rent, max_rent, min_bedrooms, max_bedrooms,
  min_bathrooms, max_bathrooms, min_area, max_area,
  home_types!home_type_id(label),
  listing_units!listing_id(bedrooms, bathrooms, area,
    unit_leases!unit_id(rent, is_active)),
  listing_landlords!listing_id(user_id, is_primary),
  listing_amenities!listing_id(
    air_conditioning, dishwasher, gym, laundry, mailroom, microwave,
    oven, parking, pets_allowed, pool, refrigerator, rooftop,
    storage, stove, study_room),
  listing_utilities!listing_id(
    electric, gas, heat, water, internet, trash, cable, sewer, cooling),
  listing_images(url, sort_order),
  listing_reviews!listing_id(rating, legitimacy, deleted_at)
`.trim();

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
