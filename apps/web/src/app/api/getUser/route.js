export const dynamic = "force-dynamic"; //so Next knows it's dynamic and not static

import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { unitIdentityLabel } from "@/lib/listings/getListing";

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

  /*
   * The viewer's OWN offerings at this property. A property can now carry leases
   * from several landlords, so the dashboard must be able to show a landlord
   * their own terms rather than the building's aggregate — which, at someone
   * else's property, is mostly other people's prices.
   */
  const myLeases = currentUserId
    ? (l.listing_units ?? []).filter((u) => !u.deleted_at).flatMap((u) =>
        (u.unit_leases ?? [])
          .filter((lease) => lease.owner_id === currentUserId)
          .map((lease) => ({
            id: lease.id,
            unitId: u.id,
            unitLabel: unitIdentityLabel(u.unit_designator, u.unit_number),
            bedrooms: u.bedrooms ?? null,
            bathrooms: u.bathrooms ?? null,
            rent: lease.rent != null ? Number(lease.rent) : null,
            leaseTermMonths: Array.isArray(lease.lease_term_months)
              ? lease.lease_term_months.map(Number)
              : [],
            sublease: !!lease.sublease,
            furnished: lease.furnished ?? null,
            availableFrom: lease.available_from ?? null,
            isActive: !!lease.is_active,
            unavailable: !!lease.unavailable,
          }))
      )
    : [];

  return {
    _id: l.id?.toString(),
    id: l.id,
    myLeases,
    title: l.title ?? null,
    address: l.address,
    description: l.description ?? null,
    unitTypes: (l.listing_units ?? []).filter((u) => !u.deleted_at).map((u) => {
      // Live offerings only — a withdrawn lease (unavailable) is not this unit's
      // current price, and showing one on the dashboard misreports the listing.
      const activeLease = (u.unit_leases ?? []).find(
        (lease) => lease.is_active && !lease.unavailable
      );
      return {
        id: u.id,
        rent: activeLease?.rent != null ? Number(activeLease.rent) : null,
        area: u.area != null ? Number(u.area) : null,
        bedrooms: u.bedrooms != null ? Number(u.bedrooms) : null,
        bathrooms: u.bathrooms != null ? Number(u.bathrooms) : null,
        title: u.title ?? null,
        identityLabel: unitIdentityLabel(u.unit_designator, u.unit_number),
        floorPlanImageUrl: u.floor_plan_image_url ?? null,
        leaseTermMonths: Array.isArray(activeLease?.lease_term_months)
          ? activeLease.lease_term_months.map(Number)
          : [],
        available: u.available ?? true,
      };
    }),
    leaseType: l.lease_type ?? null,
    leaseStructure: l.lease_structure ?? null,
    leaseAvailability: Array.isArray(l.lease_availability) ? l.lease_availability : [],
    moveInDate: l.move_in_date ? new Date(l.move_in_date).toISOString() : null,
    homeType: l.home_types?.label ?? null,
    amenities: amenitiesRowToArray(l.listing_amenities),
    customAmenities: (l.listing_custom_amenities ?? []).map((a) => a.label).filter(Boolean),
    furnished: l.furnished ?? false,
    utilitiesIncluded: utilitiesRowToArray(l.listing_utilities),
    subleaseFriendly: l.sublease_friendly ?? false,
    twentyOnePlus: l.twenty_one_plus ?? false,
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
    /*
     * Photos as the dashboard has to manage them: by scope, with the id needed
     * to delete one and a flag for whether this landlord may move it. A flat
     * list of URLs cannot express "these are the building's, those are Apt 1W's,
     * and that one is a competitor's you may see but not touch".
     */
    photos: (l.listing_images ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((i) => ({
        id: i.id,
        url: i.url,
        unitId: i.unit_id ?? null,
        mine: !!currentUserId && i.owner_id === currentUserId,
      })),
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
  lease_structure, lease_availability, furnished, move_in_date, sublease_friendly,
  twenty_one_plus, unavailable, created_at,
  min_rent, max_rent, min_bedrooms, max_bedrooms,
  min_bathrooms, max_bathrooms, min_area, max_area,
  home_types!home_type_id(label),
  listing_units!listing_id(id, bedrooms, bathrooms, area, available, title, floor_plan_image_url,
    unit_leases!unit_id(rent, is_active, sublease, lease_term_months)),
  listing_custom_amenities!listing_id(label),
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
      { data: leasedRows },
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
      // Property-level ownership. Lease-level ownership is unioned in below.
      supabase
        .from("listing_landlords")
        .select("listing_id")
        .eq("user_id", userId),
      /*
       * Properties where the landlord owns an OFFERING rather than the property
       * record — the case created by attaching a lease to someone else's
       * listing. Without this their own listing vanishes from the dashboard the
       * moment they publish it. Whether they may edit the property itself is a
       * separate question, answered by lib/listings/ownership.js.
       */
      supabase
        .from("unit_leases")
        .select("id, listing_units!unit_id(listing_id, deleted_at)")
        .eq("owner_id", userId),
    ]);

    const favoriteIds = (favInteractions ?? []).map((r) => r.listing_id);
    const contactedIds = (contactedInteractions ?? []).map((r) => r.listing_id);
    /*
     * Which KIND of ownership the landlord has at each property. A lease owner
     * belongs on the dashboard, but must not be offered Edit/Delete — those act
     * on the shared property record (PATCH replaces every unit, DELETE removes
     * the listing) and would 403. See lib/listings/ownership.js.
     * Property ownership wins when someone holds both; it is strictly broader.
     */
    const ownershipById = new Map();
    for (const r of leasedRows ?? []) {
      const u = r.listing_units;
      if (u?.listing_id && !u.deleted_at) ownershipById.set(u.listing_id, "lease");
    }
    for (const r of ownedRows ?? []) {
      if (r.listing_id) ownershipById.set(r.listing_id, "property");
    }
    const ownedIds = [...ownershipById.keys()];

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

    const safeListings = (ownListings ?? []).map((l) => ({
      ...serializeListing(l, userId, coOwnerMap, metricsMap),
      ownership: ownershipById.get(l.id) ?? "lease",
    }));
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
