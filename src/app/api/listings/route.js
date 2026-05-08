/*
 * v4 schema rewrite — 2026-04-17
 * Changes from previous version:
 *   - Removed FK hint `!` syntax from all select() calls; plain table names only
 *     (each pair of tables has at most one FK, so Supabase resolves without hints)
 *   - listing_units: unit_leases NOT nested here (browse page doesn't need per-unit rent;
 *     unitTypes[].rent is null — acceptable per spec)
 *   - listing_amenities / listing_utilities: PK is listing_id → Supabase returns single object,
 *     not array; amenitiesRowToArray / utilitiesRowToArray handle the object shape
 *   - listing_walk_times(minutes, locations(name)): shuttle_nearest handled separately
 *   - listing_landlords(user_id, is_primary): batch-fetch owners from users table
 *   - listing_images(url, sort_order): sorted ascending, mapped to URL strings
 *   - listing_reviews(rating, legitimacy, deleted_at): filtered in JS
 *   - home_types(label): single nested object { label }
 *   - Removed: lease_availability column (dropped in v4), landlord_id[], amenities[],
 *     utilities_included[], images[], home_type text, place_walk_minutes jsonb,
 *     shuttle_walk_minutes, num_reviews, rating, num_saves, num_clicks
 *   - buildListing exported for reuse in other routes
 */

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
 * 'shuttle_nearest' rows are intentionally excluded here — they appear
 * on the shuttleWalkMinutes field instead.
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
// Compute per-bed-normalised rent + dimension aggregates from listing_leases.
// Rent is normalised to per-bed: per_unit rent is divided by bedroom count so
// filter ranges are apples-to-apples regardless of how landlords price.
// ---------------------------------------------------------------------------

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
    minRent:     rents.length ? Math.min(...rents) : null,
    maxRent:     rents.length ? Math.max(...rents) : null,
    minBedrooms: beds.length  ? Math.min(...beds)  : null,
    maxBedrooms: beds.length  ? Math.max(...beds)  : null,
    minBathrooms: baths.length ? Math.min(...baths) : null,
    maxBathrooms: baths.length ? Math.max(...baths) : null,
    minArea: areas.length ? Math.min(...areas) : null,
    maxArea: areas.length ? Math.max(...areas) : null,
  };
}

// ---------------------------------------------------------------------------
// buildListing — exported for reuse across routes
// ---------------------------------------------------------------------------

export function buildListing(row, owner = null) {
  const walkTimes = row.listing_walk_times ?? [];
  const shuttle = walkTimes.find((wt) => wt.locations?.name === "shuttle_nearest");
  const legitReviews = (row.listing_reviews ?? []).filter(
    (r) => r.legitimacy && !r.deleted_at
  );

  return {
    _id: row.id,
    title: row.title ?? null,
    address: row.address,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    description: row.description,
    unitTypes: (row.listing_leases ?? [])
      .filter((l) => l.is_active && !l.deleted_at)
      .map((l) => ({
        rent: l.rent != null ? Number(l.rent) : null,
        area: l.area != null ? Number(l.area) : null,
        bedrooms: l.bedrooms != null ? Number(l.bedrooms) : null,
        bathrooms: l.bathrooms != null ? Number(l.bathrooms) : null,
        pricingBasis: l.pricing_basis,
        leaseTermMonths: l.lease_term_months,
      })),
    leaseType: (row.listing_leases ?? []).some((l) => l.is_active && !l.deleted_at && l.sublease)
      ? "Sublease" : "Standard",
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
    reviews: legitReviews,
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
    unavailable: row.unavailable ?? false,
    amenities: amenitiesRowToArray(row.listing_amenities),
    ...computeLeaseAggregates(row.listing_leases),
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
// GET /api/listings
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const { data: listings, error } = await supabase
      .from("listings")
      .select(
        `
        id, title, address, longitude, latitude, description,
        lease_type, contact_email, contact_phone, contact_name,
        lease_structure, furnished, move_in_date,
        sublease_friendly, twenty_one_plus, unavailable,
        city, state, zipcode, created_at,
        home_types(label),
        listing_leases(bedrooms, bathrooms, area, rent, pricing_basis, is_active, sublease, lease_term_months, deleted_at),
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
        listing_reviews(rating, legitimacy, deleted_at),
        listing_walk_times(minutes, locations(name))
        `
      )
      .is("deleted_at", null);

    if (error) {
      console.error("[listings GET] fetch error:", error);
      return Response.json({ error: "Failed to fetch listings" }, { status: 500 });
    }

    // Collect unique primary-landlord user IDs for a single batch fetch
    const primaryLandlordIds = [
      ...new Set(
        (listings ?? []).flatMap((l) => {
          const ll = l.listing_landlords ?? [];
          const primary = ll.find((x) => x.is_primary) ?? ll[0];
          return primary ? [primary.user_id] : [];
        })
      ),
    ];

    let landlordMap = {};
    if (primaryLandlordIds.length > 0) {
      const { data: landlordUsers, error: landlordErr } = await supabase
        .from("users")
        .select("id, name, email, image")
        .in("id", primaryLandlordIds);

      if (landlordErr) {
        console.error("[listings GET] landlord batch fetch error:", landlordErr);
      }
      for (const u of landlordUsers ?? []) landlordMap[u.id] = u;
    }

    const safeListings = (listings ?? []).map((row) => {
      const ll = row.listing_landlords ?? [];
      const primaryLandlord = ll.find((x) => x.is_primary) ?? ll[0] ?? null;
      const owner = primaryLandlord ? (landlordMap[primaryLandlord.user_id] ?? null) : null;
      return buildListing(row, owner);
    });

    return Response.json(safeListings);
  } catch (err) {
    console.error("[listings GET] unexpected error:", err);
    return Response.json({ error: "Failed to fetch listings" }, { status: 500 });
  }
}
