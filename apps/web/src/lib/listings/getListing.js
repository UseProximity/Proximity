/*
 * Shared single-listing fetch, extracted from the GET handler of
 * /api/listing/[listingId] so the listing page's generateMetadata/JSON-LD and
 * the API route render identical data. Wrapped in React cache() so the page
 * body and generateMetadata share one DB roundtrip per request.
 *
 * The increment_listing_metric click RPC intentionally stays in the API route:
 * server page renders (including crawler hits) must not inflate click metrics.
 *
 * currentUserId only affects reviews[].userVote. Server page callers omit it;
 * the API route passes the session user so vote state matches v4 behavior.
 */

import { cache } from "react";
import supabase from "@/lib/supabase";

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
 * 'shuttle_nearest' is excluded here — appears on shuttleWalkMinutes instead.
 */
function walkTimesToMap(walkTimes) {
  const map = {};
  for (const wt of walkTimes ?? []) {
    const name = wt.locations?.name;
    if (name && name !== "shuttle_nearest") map[name] = wt.minutes;
  }
  return map;
}

/**
 * Convert drive-time rows to a plain { locationName: minutes } map. All rows are
 * kept — including the synthetic *_nearest rows (gas_station_nearest, etc.),
 * which the Places tab renders via DRIVE_LABELS.
 */
function driveTimesToMap(driveTimes) {
  const map = {};
  for (const dt of driveTimes ?? []) {
    const name = dt.locations?.name;
    if (name) map[name] = dt.minutes;
  }
  return map;
}

function buildListing(row, owner = null, reviews = []) {
  const walkTimes = row.listing_walk_times ?? [];
  const driveTimes = row.listing_drive_times ?? [];
  const shuttle = walkTimes.find(
    (wt) => wt.locations?.name === "shuttle_nearest"
  );

  // Compute rating from passed-in reviews (already filtered to legit + not deleted)
  const legitReviews = reviews.filter((r) => r.legitimacy && !r.deletedAt);

  return {
    _id: row.id,
    title: row.title ?? null,
    address: row.address,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    description: row.description,
    unitTypes: (row.listing_units ?? []).map((u) => {
      const activeRent = (u.unit_leases ?? []).find((l) => l.is_active)?.rent;
      const nextAvailable =
        (u.unit_leases ?? [])
          .filter((l) => l.available_from)
          .sort(
            (a, b) => new Date(a.available_from) - new Date(b.available_from)
          )[0]?.available_from ?? null;
      const activeLease = (u.unit_leases ?? []).find((l) => l.is_active);
      return {
        id: u.id,
        rent: activeRent != null ? Number(activeRent) : null,
        area: u.area != null ? Number(u.area) : null,
        bedrooms: u.bedrooms != null ? Number(u.bedrooms) : null,
        bathrooms: u.bathrooms != null ? Number(u.bathrooms) : null,
        title: u.title ?? null,
        floorPlanImageUrl: u.floor_plan_image_url ?? null,
        leaseTermMonths: Array.isArray(activeLease?.lease_term_months)
          ? activeLease.lease_term_months.map(Number)
          : [],
        leaseAvailability: nextAvailable,
        available: u.available ?? true,
      };
    }),
    leaseType: (() => {
      const units = row.listing_units ?? [];
      const activeLeases = (us) =>
        us.flatMap((u) => (u.unit_leases ?? []).filter((l) => l.is_active));
      // Decide the listing's label from its AVAILABLE units when it has any, so an
      // available sublease surfaces as "Sublease" even alongside an unavailable
      // standard lease (and an unavailable sublease no longer forces the badge).
      const availablePool = activeLeases(units.filter((u) => u.available !== false));
      const pool = availablePool.length ? availablePool : activeLeases(units);
      return pool.some((l) => l.sublease) ? "Sublease" : "Standard";
    })(),
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
    rating: legitReviews.length
      ? Math.round(
          (legitReviews.reduce((s, r) => s + r.rating, 0) /
            legitReviews.length) *
            10
        ) / 10
      : 0,
    reviews,
    placeWalkMinutes: walkTimesToMap(walkTimes),
    placeDriveMinutes: driveTimesToMap(driveTimes),
    shuttleWalkMinutes: shuttle ? shuttle.minutes : null,
    contactEmail: row.contact_email ?? null,
    contactPhone: row.contact_phone ?? null,
    contactName: row.contact_name ?? null,
    leaseAvailability: Array.isArray(row.lease_availability) ? row.lease_availability : [],
    customAmenities: (row.listing_custom_amenities ?? [])
      .map((a) => a.label)
      .filter(Boolean),
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

/**
 * Fetch one listing with all v4 relations, reviews, and vote counts.
 * Returns the buildListing() shape, or null when the listing doesn't exist.
 * Throws on unexpected errors so callers can distinguish 404 from 500.
 */
export const getListing = cache(async (listingId, currentUserId = null) => {
  // Fetch listing with all v4 related tables
  const { data: row, error } = await supabase
    .from("listings")
    .select(
      `
      id, title, address, longitude, latitude, description,
      lease_type, contact_email, contact_phone, contact_name,
      lease_structure, furnished, move_in_date, lease_availability,
      sublease_friendly, twenty_one_plus, unavailable,
      city, state, zipcode, created_at,
      min_rent, max_rent, min_bedrooms, max_bedrooms,
      min_bathrooms, max_bathrooms, min_area, max_area,
      home_types(label),
      listing_units(
        id, bedrooms, bathrooms, area, available, title, floor_plan_image_url,
        unit_leases(rent, is_active, available_from, sublease, lease_term_months)
      ),
      listing_custom_amenities(label),
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
      listing_walk_times(minutes, locations(name)),
      listing_drive_times(minutes, locations(name))
      `
    )
    .eq("id", listingId)
    .single();

  if (error || !row) {
    // PGRST116 = no rows for .single(); treat any fetch failure here as not-found,
    // matching the previous API behavior (it returned 404 on error || !row).
    return null;
  }

  // Resolve primary landlord from listing_landlords
  const ll = row.listing_landlords ?? [];
  const primaryLandlord = ll.find((x) => x.is_primary) ?? ll[0] ?? null;

  let ownerUser = null;
  if (primaryLandlord?.user_id) {
    const { data: landlord, error: landlordErr } = await supabase
      .from("users")
      .select("id, name, email, image")
      .eq("id", primaryLandlord.user_id)
      .maybeSingle();
    if (landlordErr) {
      console.error("[getListing] landlord fetch error:", landlordErr);
    }
    ownerUser = landlord ?? null;
  }

  // Fetch reviews from listing_reviews (renamed from reviews in v4)
  // Show all reviews (including illegitimate) so the UI can mark them;
  // only legit + not-deleted count toward the rating (handled in buildListing)
  const { data: reviewRows, error: reviewErr } = await supabase
    .from("listing_reviews")
    .select(
      `
    id,
    rating,
    comment,
    legitimacy,
    communication_rating,
    location_rating,
    value_rating,
    created_at,
    deleted_at,
    user_id,
    name,
    anonymous,
    listing_review_replies (
      id,
      reply,
      created_at,
      updated_at,
      user_id
    )
  `
    )
    .eq("listing_id", listingId)
    .is("deleted_at", null);

  if (reviewErr) {
    console.error("[getListing] reviews fetch error:", reviewErr);
  }

  // Batch-fetch reviewer profiles
  const reviewerIds = [
    ...new Set((reviewRows ?? []).map((r) => r.user_id).filter(Boolean)),
  ];
  let reviewerMap = {};
  if (reviewerIds.length > 0) {
    const { data: reviewerUsers, error: reviewerErr } = await supabase
      .from("users")
      .select("id, name, image")
      .in("id", reviewerIds);
    if (reviewerErr) {
      console.error("[getListing] reviewer batch fetch error:", reviewerErr);
    }
    for (const u of reviewerUsers ?? []) reviewerMap[u.id] = u;
  }

  // Fetch vote counts from review_votes (replaced upvotes/downvotes arrays)
  const reviewIds = (reviewRows ?? []).map((r) => r.id);
  let votesByReview = {};
  if (reviewIds.length > 0) {
    const { data: voteRows, error: voteErr } = await supabase
      .from("review_votes")
      .select("review_id, vote, user_id")
      .in("review_id", reviewIds);
    if (voteErr) {
      console.error("[getListing] vote fetch error:", voteErr);
    }
    for (const v of voteRows ?? []) {
      if (!votesByReview[v.review_id])
        votesByReview[v.review_id] = { up: 0, down: 0, userVote: null };
      if (v.vote === "up") votesByReview[v.review_id].up += 1;
      else if (v.vote === "down") votesByReview[v.review_id].down += 1;
      if (currentUserId && v.user_id === currentUserId)
        votesByReview[v.review_id].userVote = v.vote;
    }
  }

  const reviews = (reviewRows ?? []).map((r) => {
    // Anonymous reviews never expose the author — drop the profile join entirely
    // so the UI falls back to "Anonymous" + default avatar.
    const reviewer = r.anonymous || !r.user_id ? null : reviewerMap[r.user_id];
    const votes = votesByReview[r.id] ?? { up: 0, down: 0, userVote: null };
    return {
      _id: r.id,
      rating: r.rating,
      comment: r.comment,
      legitimacy: r.legitimacy ?? false,
      communicationRating: r.communication_rating ?? null,
      locationRating: r.location_rating ?? null,
      valueRating: r.value_rating ?? null,
      createdAt: r.created_at ?? null,
      deletedAt: r.deleted_at ?? null,
      upvotes: votes.up,
      downvotes: votes.down,
      userVote: votes.userVote,
      reviewer: reviewer
        ? {
            _id: reviewer.id,
            name: reviewer.name,
            image: reviewer.image ?? null,
          }
        : r.name
        ? { _id: null, name: r.name, image: null }
        : null,
      landlordReply: r.listing_review_replies
        ? {
            id: r.listing_review_replies.id,
            reply: r.listing_review_replies.reply,
            createdAt: r.listing_review_replies.created_at,
            updatedAt: r.listing_review_replies.updated_at,
            userId: r.listing_review_replies.user_id,
          }
        : null,
    };
  });

  return buildListing(row, ownerUser, reviews);
});
