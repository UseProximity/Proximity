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
    unitTypes: (row.listing_units ?? []).map((u) => {
      const activeRent = (u.unit_leases ?? []).find((l) => l.is_active)?.rent;
      return {
        rent: activeRent != null ? Number(activeRent) : null,
        area: u.area != null ? Number(u.area) : null,
        bedrooms: u.bedrooms != null ? Number(u.bedrooms) : null,
        bathrooms: u.bathrooms != null ? Number(u.bathrooms) : null,
        available: u.available ?? true,
      };
    }),
    leaseType: (row.listing_units ?? []).some((u) =>
      (u.unit_leases ?? []).some((l) => l.is_active && l.sublease)
    ) ? "Sublease" : "Standard",
    images: (row.listing_images ?? [])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((img) => img.url),
    // True when the cover photo (lowest sort_order) was auto-fetched from Google Street View.
    imageFromStreetView:
      (row.listing_images ?? [])
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.source ===
      "street_view",
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
    unavailable: (() => {
      if (row.unavailable) return true;
      const units = row.listing_units ?? [];
      // Treat the listing as unavailable if it has units and none of them are available.
      // Empty unit lists do NOT flip the listing — that's a separate data issue.
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
        min_rent, max_rent, min_bedrooms, max_bedrooms,
        min_bathrooms, max_bathrooms, min_area, max_area,
        home_types(label),
        listing_units(id, bedrooms, bathrooms, area, available, unit_leases(rent, is_active, sublease)),
        listing_landlords(user_id, is_primary),
        listing_amenities(
          air_conditioning, dishwasher, gym, laundry, mailroom, microwave,
          oven, parking, pets_allowed, pool, refrigerator, rooftop,
          storage, stove, study_room
        ),
        listing_utilities(
          electric, gas, heat, water, internet, trash, cable, sewer, cooling
        ),
        listing_images(url, sort_order, source),
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
