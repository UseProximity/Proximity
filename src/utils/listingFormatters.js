// ─── Private helpers ─────────────────────────────────────────────────────────

function computeRentRange(unitTypes) {
  const rents = unitTypes
    .map((unit) => Number(unit?.rent))
    .filter((rent) => Number.isFinite(rent) && rent > 0);
  if (rents.length === 0) return null;
  return { min: Math.min(...rents), max: Math.max(...rents) };
}

function formatRentRange(min, max) {
  return min === max
    ? `$${min.toLocaleString()}`
    : `$${min.toLocaleString()}-$${max.toLocaleString()}`;
}

// ─── Lease terms ──────────────────────────────────────────────────────────────

// A unit's lease durations are stored as month counts (unit_leases.lease_term_months).
// These map to the canonical lease_availability labels used by filters + display.
export function leaseMonthsToLabel(months) {
  const n = Number(months);
  if (n === 4) return "summer";
  if (n === 5) return "semester";
  return `${n}-month`;
}

// Derive a listing's lease_availability label array from the union of its units'
// lease term months. Sorted by month so display order is stable.
export function deriveLeaseAvailability(unitTypes = []) {
  const months = new Set();
  for (const u of unitTypes ?? []) {
    const terms = Array.isArray(u?.leaseTermMonths) ? u.leaseTermMonths : [];
    for (const m of terms) {
      const n = Number(m);
      if (Number.isFinite(n) && n > 0) months.add(n);
    }
  }
  return Array.from(months)
    .sort((a, b) => a - b)
    .map(leaseMonthsToLabel);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const getRentRangeLabel = (unitTypes = []) => {
  const range = computeRentRange(unitTypes);
  if (!range) return "Contact for Pricing";
  return formatRentRange(range.min, range.max);
};

export const getRentRangeDisplay = (unitTypes = []) => {
  const range = computeRentRange(unitTypes);
  if (!range) return { label: "Contact for Pricing", hasPrice: false };
  return { label: formatRentRange(range.min, range.max), hasPrice: true };
};

export const getUnitValuesLabel = (unitTypes = [], field) => {
  const values = unitTypes
    .map((unit) => Number(unit?.[field]))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return "N/A";
  }

  const uniqueSorted = Array.from(new Set(values)).sort((a, b) => a - b);
  return uniqueSorted.join(", ");
};

export const getAreaRangeLabel = (unitTypes = []) => {
  const areas = unitTypes
    .map((unit) => Number(unit?.area))
    .filter((area) => Number.isFinite(area) && area > 0);

  if (areas.length === 0) {
    return "-";
  }

  const minArea = Math.min(...areas);
  const maxArea = Math.max(...areas);

  if (minArea === maxArea) {
    return minArea.toLocaleString();
  }

  return `${minArea.toLocaleString()}-${maxArea.toLocaleString()}`;
};

export function calcAge(birthday) {
  if (!birthday) return null;
  const dob = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

// ─── Supabase → Frontend Shape ────────────────────────────────────────────────

/**
 * Transforms a raw Supabase listings row (plus its related rows) into the
 * camelCase shape expected by all frontend components.
 *
 * The `listing_units` table stores certain listing-level fields (furnished,
 * amenities, leaseAvailability, etc.) on every unit row. Those fields are read
 * from the first unit; if no units exist the fields default to safe values.
 *
 * @param {object} listingRow  - Raw row from the `listings` Supabase table.
 * @param {object[]} units     - Rows from `listing_units` for this listing.
 * @param {object|null} owner  - Joined user row for the landlord (or null).
 * @param {object[]} reviews   - Joined review rows with nested reviewer info.
 * @returns {object}           - Fully shaped listing object for the frontend.
 */
export function normalizeListing({ listingRow, units = [], owner = null, reviews = [] }) {
  // Per-unit fields: each unit holds its own values; listing-level fields
  // (lease details, amenities, etc.) are identical across all units in practice.
  const firstUnit = units[0] ?? null;

  const unitTypes = units.map((u) => ({
    rent:      u.rent      != null ? Number(u.rent)      : null,
    area:      u.area      != null ? Number(u.area)      : null,
    bedrooms:  u.bedrooms  != null ? Number(u.bedrooms)  : null,
    bathrooms: u.bathrooms != null ? Number(u.bathrooms) : null,
  }));

  const placeWalkMinutes =
    listingRow.place_walk_minutes && typeof listingRow.place_walk_minutes === "object"
      ? { ...listingRow.place_walk_minutes }
      : {};

  const normalizedReviews = reviews.map((r) => ({
    rating:              r.rating               ?? 0,
    comment:             r.comment              ?? "",
    legitimacy:          r.legitimacy           ?? false,
    communicationRating: r.communication_rating ?? null,
    locationRating:      r.location_rating      ?? null,
    valueRating:         r.value_rating         ?? null,
    createdAt:           r.created_at           ?? null,
    reviewer: r.reviewer
      ? { _id: String(r.reviewer.id ?? ""), name: r.reviewer.name ?? null, image: r.reviewer.image ?? null }
      : r.name ? { _id: null, name: r.name, image: null } : null,
  }));

  const normalizedOwner = owner
    ? { _id: String(owner.id ?? ""), name: owner.name ?? null, email: owner.email ?? null, image: owner.image ?? null }
    : null;

  return {
    _id:               String(listingRow.id ?? ""),
    title:             listingRow.title           ?? null,
    address:           listingRow.address         ?? "",
    longitude:         listingRow.longitude       != null ? Number(listingRow.longitude) : null,
    latitude:          listingRow.latitude        != null ? Number(listingRow.latitude)  : null,
    description:       listingRow.description     ?? "",
    homeType:          listingRow.home_type        ?? "apartment",
    leaseType:         listingRow.lease_type       ?? null,
    images:            Array.isArray(listingRow.images) ? listingRow.images : [],
    placeWalkMinutes,
    shuttleWalkMinutes: listingRow.shuttle_walk_minutes != null ? Number(listingRow.shuttle_walk_minutes) : null,
    contactEmail:      listingRow.contact_email   ?? null,
    contactPhone:      listingRow.contact_phone   ?? null,
    contactName:       listingRow.contact_name    ?? null,
    numReviews:        Number(listingRow.num_reviews ?? 0),
    rating:            Number(listingRow.rating      ?? 0),
    numClicks:         Number(listingRow.num_clicks  ?? 0),
    numSaves:          Number(listingRow.num_saves   ?? 0),
    minRent:           listingRow.min_rent       != null ? Number(listingRow.min_rent)       : null,
    maxRent:           listingRow.max_rent       != null ? Number(listingRow.max_rent)       : null,
    minBedrooms:       listingRow.min_bedrooms   != null ? Number(listingRow.min_bedrooms)   : null,
    maxBedrooms:       listingRow.max_bedrooms   != null ? Number(listingRow.max_bedrooms)   : null,
    minBathrooms:      listingRow.min_bathrooms  != null ? Number(listingRow.min_bathrooms)  : null,
    maxBathrooms:      listingRow.max_bathrooms  != null ? Number(listingRow.max_bathrooms)  : null,
    minArea:           listingRow.min_area       != null ? Number(listingRow.min_area)       : null,
    maxArea:           listingRow.max_area       != null ? Number(listingRow.max_area)       : null,
    unitTypes,
    // Listing-level fields (migrated from listing_units)
    furnished:         listingRow.furnished            ?? false,
    utilitiesIncluded: Array.isArray(listingRow.utilities_included) ? listingRow.utilities_included : [],
    leaseAvailability: firstUnit?.lease_availability   ?? null,  // stays per-unit
    leaseStructure:    listingRow.lease_structure       ?? null,
    moveInDate:        listingRow.move_in_date          ?? null,
    subleaseFriendly:  listingRow.sublease_friendly     ?? false,
    amenities:         Array.isArray(listingRow.amenities) ? listingRow.amenities : [],
    unavailable:       listingRow.unavailable           ?? false,
    owner:             normalizedOwner,
    reviews:           normalizedReviews,
    createdAt:         listingRow.created_at ?? null,
  };
}
