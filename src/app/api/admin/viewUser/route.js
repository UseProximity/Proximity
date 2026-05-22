export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import supabase from "@/lib/supabase";

const LISTING_SELECT = `
  id, title, address, description, latitude, longitude, created_at,
  lease_type, lease_structure, lease_availability, furnished, move_in_date, unavailable,
  sublease_friendly, twenty_one_plus, contact_email, contact_phone, contact_name,
  min_rent, max_rent, min_bedrooms, max_bedrooms,
  home_types(label),
  listing_units(bedrooms, bathrooms, area),
  listing_landlords(user_id, is_primary),
  listing_amenities(air_conditioning, dishwasher, gym, laundry, mailroom, microwave, oven, parking, pets_allowed, pool, refrigerator, rooftop, storage, stove, study_room),
  listing_utilities(electric, gas, heat, water, internet, trash, cable, sewer, cooling),
  listing_images(url, sort_order),
  listing_reviews(rating, legitimacy, deleted_at)
`;

function amenitiesRowToArray(row) {
  if (!row) return [];
  return ["air_conditioning","dishwasher","gym","laundry","mailroom","microwave","oven",
    "parking","pets_allowed","pool","refrigerator","rooftop","storage","stove","study_room"]
    .filter(k => row[k] === true);
}

function utilitiesRowToArray(row) {
  if (!row) return [];
  return ["electric","gas","heat","water","internet","trash","cable","sewer","cooling"]
    .filter(k => row[k] === true);
}

function serializeListing(l, currentUserId = null, coOwnerMap = {}) {
  const legitReviews = (l.listing_reviews ?? []).filter(r => r.legitimacy && !r.deleted_at);
  const landlordRows = l.listing_landlords ?? [];
  const ownerIds = landlordRows.map(r => r.user_id);
  const coOwners = ownerIds
    .filter(id => id !== currentUserId)
    .map(id => ({ id, name: coOwnerMap[id]?.name ?? null, email: coOwnerMap[id]?.email ?? null }));
  return {
    _id: l.id?.toString(),
    id: l.id,
    title: l.title ?? null,
    address: l.address,
    description: l.description ?? null,
    unitTypes: (l.listing_units ?? []).map(u => ({ bedrooms: u.bedrooms, bathrooms: u.bathrooms, area: u.area, rent: null })),
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
    contactEmail: l.contact_email ?? null,
    contactPhone: l.contact_phone ?? null,
    contactName: l.contact_name ?? null,
    unavailable: l.unavailable ?? false,
    minRent: l.min_rent,
    maxRent: l.max_rent,
    minBedrooms: l.min_bedrooms,
    maxBedrooms: l.max_bedrooms,
    images: (l.listing_images ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(i => i.url),
    numClicks: 0,
    numSaves: 0,
    numReviews: legitReviews.length,
    rating: legitReviews.length ? legitReviews.reduce((s, r) => s + r.rating, 0) / legitReviews.length : 0,
    owner: ownerIds[0] ?? null,
    coOwners,
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

    const { data: reqUser } = await supabase
      .from("users")
      .select("id, roles!role_id(name)")
      .eq("email", session.user.email)
      .single();

    const reqRole = reqUser?.roles?.name;
    if (reqRole !== "super" && reqRole !== "admin") {
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

    // Get interaction type IDs
    const { data: types } = await supabase.from("interaction_types").select("id, name");
    const typeMap = Object.fromEntries((types ?? []).map(t => [t.name, t.id]));

    // Get owned listing IDs
    const { data: ownedRows } = await supabase
      .from("listing_landlords")
      .select("listing_id")
      .eq("user_id", userId);
    const ownedIds = (ownedRows ?? []).map(r => r.listing_id);

    // Get favorite and contacted listing IDs
    const [favRows, contactedRowsResult] = await Promise.all([
      typeMap.saved
        ? supabase.from("user_listing_interactions").select("listing_id").eq("user_id", userId).eq("interaction_type_id", typeMap.saved)
        : Promise.resolve({ data: [] }),
      typeMap.contacted
        ? supabase.from("user_listing_interactions").select("listing_id").eq("user_id", userId).eq("interaction_type_id", typeMap.contacted)
        : Promise.resolve({ data: [] }),
    ]);

    const favIds = (favRows.data ?? []).map(r => r.listing_id);
    const contactedIds = (contactedRowsResult.data ?? []).map(r => r.listing_id);

    // Fetch all three sets of listings in parallel
    const allIds = [...new Set([...ownedIds, ...favIds, ...contactedIds])];
    let listingMap = {};
    if (allIds.length > 0) {
      const { data: allListings } = await supabase
        .from("listings")
        .select(LISTING_SELECT)
        .in("id", allIds)
        .is("deleted_at", null);
      for (const l of allListings ?? []) listingMap[l.id] = l;
    }

    // Build co-owner map from owned listings
    const coOwnerIds = new Set();
    for (const id of ownedIds) {
      const l = listingMap[id];
      if (l) for (const row of (l.listing_landlords ?? [])) {
        if (row.user_id !== userId) coOwnerIds.add(row.user_id);
      }
    }
    let coOwnerMap = {};
    if (coOwnerIds.size > 0) {
      const { data: coOwnerUsers } = await supabase.from("users").select("id, name, email").in("id", [...coOwnerIds]);
      for (const u of coOwnerUsers ?? []) coOwnerMap[u.id] = u;
    }

    const safeListings = ownedIds.map(id => listingMap[id]).filter(Boolean).map(l => serializeListing(l, userId, coOwnerMap));
    const safeFavorites = favIds.map(id => listingMap[id]).filter(Boolean).map(l => serializeListing(l));
    const safeContacted = contactedIds.map(id => listingMap[id]).filter(Boolean).map(l => serializeListing(l));

    return Response.json({
      ...user,
      _id: user.id?.toString(),
      favorites: safeFavorites,
      favoritesIds: safeFavorites.map(f => f._id),
      listings: safeListings,
      contacted: safeContacted,
      contactedIds: safeContacted.map(l => l._id),
      listingsIds: safeListings.map(l => l._id),
      createdAt: user.created_at ? new Date(user.created_at).toISOString() : null,
      updatedAt: user.updated_at ? new Date(user.updated_at).toISOString() : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/admin/viewUser failed:", error);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
