/*
 * Browse filtering, evaluated against the property → unit → lease model.
 *
 * The rule this file exists to enforce: a listing qualifies only when ONE unit
 * satisfies every unit-scoped filter, and ONE offering on that unit satisfies
 * every lease-scoped filter. Filters used to run against denormalized aggregate
 * columns on `listings` (min_rent, max_bedrooms, …), which are independent
 * min/max boxes — so a building with a 1-bed at $1,200 and a 2-bed at $2,400
 * matched "2 bed under $1,500" even though no such unit exists. Testing each
 * dimension separately can only ever produce that cross-product.
 *
 * Three scopes, and which table each reads:
 *
 *   PROPERTY (listings + its amenity/utility/walk-time relations)
 *     search, home type, amenities, utilities, walk times, lease structure,
 *     sublease-friendly, saved. True of the building regardless of unit.
 *
 *   UNIT (listing_units)
 *     bedrooms, bathrooms. Physical facts, so they must co-occur with the price.
 *
 *   LEASE (unit_leases)
 *     price, furnished, lease length, sublease, move-in date. One landlord's
 *     offering — all of these must hold on the SAME offering, because that is
 *     the thing a renter would actually be signing.
 *
 * Missing PRICE never excludes. A unit with no live lease has no rent, and 42%
 * of listings are in that state today; dropping them the moment someone touches
 * the price slider would hide most of the marketplace. They stay in the results
 * and sink to the bottom instead (see priceUnknown).
 *
 * The other lease filters are not ranges but categorical claims — "this offering
 * is a sublease", "this offering comes furnished", "this offering runs 12
 * months". A unit with no offering cannot make any of those claims, so it is not
 * an answer to them and is excluded. Silently padding a sublease search with
 * places that have never published lease terms is worse than a short list.
 */

export const DEFAULT_FILTERS = {
  minRent: "",
  maxRent: "",
  bedrooms: "", // min bedrooms
  maxBedrooms: "", // max bedrooms
  bathrooms: "", // min bathrooms
  maxBathrooms: "", // max bathrooms
  distance: "", // walking time to campus (minutes)
  distanceToShuttle: "", // walking time to shuttle stop (minutes)
  moveInDate: "",
  homeType: [], // ['house','apartment','condo','townhouse','singleBedroom']
  leaseAvailability: [], // ['semester','10-month','12-month','summer']
  amenities: [],
  furnished: "", // '' | 'furnished' | 'unfurnished'
  utilitiesIncluded: [],
  subleaseFriendly: false,
  subleaseOnly: false, // only show actual sublease offerings
  leaseStructure: "", // '' | 'individual' | 'joint'
  savedOnly: false,
};

const num = (v) => (v === "" || v == null ? null : Number(v));

/*
 * Lease-length buckets, matched against unit_leases.lease_term_months — the
 * array of every term a landlord will accept, so [4,5,10,12] is one flexible
 * offering that satisfies "semester", "10-month" AND "12-month".
 */
const TERM_BUCKETS = {
  summer: (m) => m <= 3,
  semester: (m) => m >= 4 && m <= 6,
  "10-month": (m) => m === 10,
  "12-month": (m) => m === 12,
};

// ---------------------------------------------------------------------------
// Lease scope
// ---------------------------------------------------------------------------

/** True when this single offering satisfies every lease-scoped filter. */
export function leaseMatches(lease, filters) {
  // Price. A null rent is "ask the landlord", not "free" and not "expensive" —
  // it can't contradict the range, so it passes and is demoted in the sort.
  if (lease.rent != null) {
    const min = num(filters.minRent);
    const max = num(filters.maxRent);
    if (min != null && lease.rent < min) return false;
    if (max != null && lease.rent > max) return false;
  }

  // Furnishing is per-offering: the same unit can be let furnished by one
  // landlord and bare by another.
  if (filters.furnished === "furnished" && lease.furnished === false) return false;
  if (filters.furnished === "unfurnished" && lease.furnished === true) return false;

  if (filters.leaseAvailability?.length) {
    const months = lease.leaseTermMonths ?? [];
    if (months.length) {
      const ok = filters.leaseAvailability.some((key) => {
        const inBucket = TERM_BUCKETS[key];
        return inBucket ? months.some(inBucket) : true;
      });
      if (!ok) return false;
    }
  }

  if (filters.subleaseOnly && !lease.sublease) return false;

  // "Move in by X": the offering must open on or before that date. Most leases
  // carry no available_from yet, and an unstated date is not a late one.
  if (filters.moveInDate && lease.availableFrom) {
    if (new Date(lease.availableFrom) > new Date(filters.moveInDate)) return false;
  }

  return true;
}

/** Any lease-scoped filter engaged? Decides how unit-less listings are treated. */
function leaseFiltersActive(filters) {
  return !!(filters.minRent || filters.maxRent || categoricalLeaseFilters(filters));
}

/*
 * Lease filters a unit cannot answer without an actual offering. Price is
 * deliberately absent: an unpriced unit is still a real answer to "under
 * $1,500", it just can't prove it. A unit with no offering at all, on the other
 * hand, has nothing to say about furnishing, lease length, sublease status or
 * move-in — so it is not a match for those.
 */
function categoricalLeaseFilters(filters) {
  return !!(
    filters.furnished ||
    filters.subleaseOnly ||
    filters.moveInDate ||
    filters.leaseAvailability?.length
  );
}

function unitFiltersActive(filters) {
  return !!(
    filters.bedrooms ||
    filters.maxBedrooms ||
    filters.bathrooms ||
    filters.maxBathrooms
  );
}

// ---------------------------------------------------------------------------
// Unit scope
// ---------------------------------------------------------------------------

/**
 * The units a renter could actually take. Falls back to every unit when none is
 * marked available, so a fully-let building still matches its own bed/bath
 * shape instead of vanishing — browse has never hidden those.
 */
function unitPool(listing) {
  const units = listing.unitTypes ?? [];
  const open = units.filter((u) => u.available !== false);
  return open.length ? open : units;
}

/**
 * Match one unit and pick the offering a renter would land on.
 * Returns { unit, lease, priceKnown } or null.
 */
export function unitMatch(unit, filters) {
  // Beds/baths are structural, not pending data: a unit that never recorded its
  // bedroom count cannot be shown as an answer to "3 bedrooms".
  const minBeds = num(filters.bedrooms);
  const maxBeds = num(filters.maxBedrooms);
  if (minBeds != null || maxBeds != null) {
    if (unit.bedrooms == null) return null;
    if (minBeds != null && unit.bedrooms < minBeds) return null;
    if (maxBeds != null && unit.bedrooms > maxBeds) return null;
  }

  const minBaths = num(filters.bathrooms);
  const maxBaths = num(filters.maxBathrooms);
  if (minBaths != null || maxBaths != null) {
    if (unit.bathrooms == null) return null;
    if (minBaths != null && unit.bathrooms < minBaths) return null;
    if (maxBaths != null && unit.bathrooms > maxBaths) return null;
  }

  const leases = unit.leases ?? [];

  // No live offering at all — the unit is real, its terms simply aren't
  // published. Keep it (flagged unpriced) for a price question, drop it for one
  // it has no way to answer.
  if (!leases.length) {
    return categoricalLeaseFilters(filters)
      ? null
      : { unit, lease: null, priceKnown: false };
  }

  const passing = leases.filter((l) => leaseMatches(l, filters));
  if (!passing.length) return null;

  // shapeLeases() already sorts cheapest-first with unpriced sunk, so the first
  // priced survivor is the cheapest offering that fits.
  const best = passing.find((l) => l.rent != null) ?? passing[0];
  return { unit, lease: best, priceKnown: best.rent != null };
}

// ---------------------------------------------------------------------------
// Property scope
// ---------------------------------------------------------------------------

// Canonical filter value → every DB value that means it (snake_case + legacy ALL_CAPS)
const AMENITY_ALIASES = {
  dishwasher: ["dishwasher", "DISHWASHER"],
  in_unit_laundry: ["in_unit_laundry", "IN-UNIT LAUNDRY", "IN UNIT LAUNDRY"],
  ac_heating: ["ac_heating"],
  mailroom: ["mailroom", "MAILROOM"],
  pets_allowed: ["pets_allowed", "PETS ALLOWED"],
  extra_storage: ["extra_storage", "EXTRA STORAGE"],
  fireplace: ["fireplace", "FIREPLACE"],
  private_parking: ["private_parking", "FREE PARKING"],
  pool: ["pool", "POOL"],
  study_room: ["study_room", "STUDY ROOMS"],
  gym: ["gym", "GYM"],
};

function propertyMatches(listing, { filters, search, savedIds, campusMinutes }) {
  const lt = listing?.homeType?.toLowerCase() || "";
  const desc = listing?.description?.toLowerCase() || "";

  const q = search.trim().toLowerCase();
  if (
    q &&
    !listing?.address?.toLowerCase().includes(q) &&
    !listing?.title?.toLowerCase().includes(q)
  ) {
    return false;
  }

  if (filters.distance) {
    const mins = campusMinutes(listing);
    if (mins == null || mins > parseFloat(filters.distance)) return false;
  }

  if (filters.distanceToShuttle) {
    const m = listing.shuttleWalkMinutes;
    if (m == null || m > parseFloat(filters.distanceToShuttle)) return false;
  }

  if (filters.homeType?.length) {
    const ok = filters.homeType.some((type) => {
      switch (type) {
        case "house":
          return lt.includes("house");
        case "apartment":
          return lt.includes("apartment");
        case "condo":
          return lt.includes("condo");
        case "townhouse":
          return lt.includes("townhouse");
        // A shape question rather than a building type — answered from the
        // units themselves now that they are available here.
        case "singleBedroom":
          return unitPool(listing).some((u) => u.bedrooms === 1);
        default:
          return true;
      }
    });
    if (!ok) return false;
  }

  if (filters.amenities?.length) {
    const arr = listing.amenities || [];
    const ok = filters.amenities.every((amenity) =>
      (AMENITY_ALIASES[amenity] ?? [amenity]).some((v) => arr.includes(v))
    );
    if (!ok) return false;
  }

  if (filters.utilitiesIncluded?.length) {
    const incl = Array.isArray(listing?.utilitiesIncluded)
      ? listing.utilitiesIncluded
      : [];
    if (!filters.utilitiesIncluded.every((u) => incl.includes(u))) return false;
  }

  // "Allows subletting" — a property policy, unlike subleaseOnly which asks
  // whether a specific offering IS a sublease.
  if (filters.subleaseFriendly) {
    const ok =
      listing?.subleaseFriendly === true ||
      desc.includes("subleas") ||
      desc.includes("subletting allowed");
    if (!ok) return false;
  }

  if (filters.leaseStructure === "individual") {
    const ok =
      listing?.leaseStructure === "individual" ||
      desc.includes("individual lease") ||
      desc.includes("by the room");
    if (!ok) return false;
  } else if (filters.leaseStructure === "joint") {
    const ok =
      listing?.leaseStructure === "joint" ||
      desc.includes("joint lease") ||
      desc.includes("whole unit");
    if (!ok) return false;
  }

  if (filters.savedOnly && !savedIds.includes(String(listing._id))) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Listing scope
// ---------------------------------------------------------------------------

/**
 * Match one listing and resolve which unit satisfied the filters.
 * Returns the listing annotated with matchedUnitId, or null.
 */
export function matchListing(listing, ctx) {
  if (!propertyMatches(listing, ctx)) return null;

  const { filters } = ctx;
  const narrowed = unitFiltersActive(filters) || leaseFiltersActive(filters);
  const units = unitPool(listing);

  // Imported listings that never had their units broken out. Nothing to test a
  // bed/bath or price question against, so they answer only the property ones.
  if (!units.length) {
    if (narrowed) return null;
    return { ...listing, matchedUnitId: null, priceUnknown: true };
  }

  const matches = units.map((u) => unitMatch(u, filters)).filter(Boolean);
  if (!matches.length) return null;

  // The unit the panel should open on: cheapest fitting offering wins, and a
  // real number always beats an unpriced one.
  const priced = matches.filter((m) => m.priceKnown);
  const best = priced.length
    ? priced.reduce((a, b) => (b.lease.rent < a.lease.rent ? b : a))
    : matches[0];

  return {
    ...listing,
    /*
     * Only claim a match when the renter actually narrowed something. With no
     * filters on, every unit "matches" and the cheapest would win — which would
     * silently override the panel's own smallest-unit-first tab order for plain
     * browsing.
     */
    matchedUnitId: narrowed ? best.unit.id ?? null : null,
    priceUnknown: !best.priceKnown,
  };
}

/**
 * Filter and rank the browse feed.
 *
 * `campusMinutes(listing)` is injected rather than imported so this module stays
 * free of the WashU place list and can be unit-tested on plain objects.
 */
export function filterListings(listings, { filters, search = "", savedIds = [], campusMinutes }) {
  const ctx = { filters, search, savedIds, campusMinutes };
  const priceFilterOn = !!(filters.minRent || filters.maxRent);

  return listings
    .map((l) => matchListing(l, ctx))
    .filter(Boolean)
    .sort((a, b) => {
      // 0) Only while a price filter is engaged: listings whose price is simply
      //    unpublished sink below the ones that provably fit the range. They are
      //    still shown — a renter can ask — just never ahead of a real match.
      if (priceFilterOn && !!a.priceUnknown !== !!b.priceUnknown) {
        return a.priceUnknown ? 1 : -1;
      }

      // 1) Listings with photos rank above photoless ones.
      const aHasImages = a.images?.length > 0;
      const bHasImages = b.images?.length > 0;
      if (aHasImages !== bHasImages) return aHasImages ? -1 : 1;

      // 2) Reviewed listings rank first. A future availableFrom is deliberately
      //    NOT a demotion: a pre-leased listing still shows in full colour with
      //    an "Available Aug 1" badge, and it is inventory a renter can sign
      //    today for a later move-in. It competes on the same footing as one
      //    open now. Only `unavailable` sinks, and that happens in
      //    AvailableListings where the greyed-out cards are collected.
      const aReviews = a.numReviews ?? 0;
      const bReviews = b.numReviews ?? 0;
      if (aReviews > 0 !== bReviews > 0) return aReviews > 0 ? -1 : 1;

      // 3) Among reviewed listings, higher rating wins, then more reviews.
      if (aReviews > 0 && bReviews > 0) {
        if (b.rating !== a.rating) return (b.rating ?? 0) - (a.rating ?? 0);
        return bReviews - aReviews;
      }
      return 0;
    });
}
