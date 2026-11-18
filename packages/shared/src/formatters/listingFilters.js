import { WASHU_PLACES, NON_CAMPUS_WALK_PLACES } from "../constants/places.js";

// Browse filter defaults. Keep in step with DEFAULT_FILTERS in
// apps/web/src/lib/listings/filterListings.js.
export const DEFAULT_FILTERS = {
  minRent: "",
  maxRent: "",
  bedrooms: "",
  maxBedrooms: "",
  bathrooms: "",
  maxBathrooms: "",
  distance: "",
  distanceToShuttle: "",
  moveInDate: "",
  moveInMonth: "",
  moveInDay: "",
  homeType: [],
  leaseAvailability: [],
  amenities: [],
  furnished: "",
  utilitiesIncluded: [],
  subleaseFriendly: false,
  subleaseOnly: false,
  leaseStructure: "",
  savedOnly: false,
};

// True when any filter differs from its default.
export const filtersActive = (filters) =>
  Object.keys(DEFAULT_FILTERS).some(
    (k) =>
      JSON.stringify(filters[k] ?? DEFAULT_FILTERS[k]) !==
      JSON.stringify(DEFAULT_FILTERS[k])
  );

// Canonical filter-chip amenity values are a distinct, smaller vocabulary
// from packages/shared's AMENITY_OPTIONS (which mirrors the DB columns) -
// this mirrors a pre-existing inconsistency in web itself between its
// filter UI and its listing-form UI, not something to unify here.
export const FILTER_AMENITY_OPTIONS = [
  "dishwasher",
  "in_unit_laundry",
  "ac_heating",
  "mailroom",
  "pets_allowed",
  "extra_storage",
  "fireplace",
  "private_parking",
  "pool",
  "study_room",
  "gym",
];

export const FILTER_AMENITY_LABELS = {
  dishwasher: "Dishwasher",
  in_unit_laundry: "In-Unit Laundry",
  ac_heating: "A/C & Heating",
  mailroom: "Mailroom",
  pets_allowed: "Pets Allowed",
  extra_storage: "Extra Storage",
  fireplace: "Fireplace",
  private_parking: "Private Parking",
  pool: "Pool",
  study_room: "Study Room",
  gym: "Gym",
};

export const HOME_TYPE_FILTER_OPTIONS = ["house", "apartment", "condo", "townhouse", "singleBedroom"];
export const HOME_TYPE_FILTER_LABELS = {
  house: "House",
  apartment: "Apartment",
  condo: "Condo",
  townhouse: "Townhouse",
  singleBedroom: "Single Bedroom",
};

export const LEASE_AVAILABILITY_FILTER_OPTIONS = ["summer", "semester", "10-month", "12-month"];
export const LEASE_AVAILABILITY_FILTER_LABELS = {
  summer: "Summer",
  semester: "Semester",
  "10-month": "10-Month",
  "12-month": "12-Month",
};

/*
 * Everything from here to countActiveFilters is a copy of the web Browse logic
 * in apps/web/src/lib/listings/filterListings.js (the source of truth). Keep the
 * two in step. Only differences: filterListings defaults `campusMinutes` to the
 * shared place list, and rankBrowseListings adds the final step web applies in
 * AvailableListings.js.
 */

// Minimum walk minutes to campus, with the same place set as web's BrowseContent
// (grocery + Med Campus excluded via NON_CAMPUS_WALK_PLACES).
export function defaultCampusMinutes(listing) {
  const pwm = listing?.placeWalkMinutes;
  const mins = WASHU_PLACES.filter((p) => !NON_CAMPUS_WALK_PLACES.includes(p.name))
    .map((p) => pwm?.[p.name])
    .filter((m) => m != null);
  return mins.length ? Math.min(...mins) : null;
}

const num = (v) => (v === "" || v == null ? null : Number(v));

const pad2 = (n) => String(n).padStart(2, "0");

/*
 * The date (YYYY-MM-DD) a "move in in August" filter means: the last day of
 * the next August, or with a day, that day of it. The current month counts as
 * this year's unless the chosen day has already passed, which means next
 * year's. A day the month does not have that year (Feb 29) becomes its last
 * day. `today` is the renter's own date, not UTC.
 */
export function moveInDeadline(month, day, today = new Date()) {
  const m = Number(month);
  if (!(m >= 1 && m <= 12)) return null;
  const d = Number(day) || null;
  const thisMonth = today.getMonth() + 1;
  const passed = m < thisMonth || (m === thisMonth && d && d < today.getDate());
  const year = today.getFullYear() + (passed ? 1 : 0);
  const lastDay = new Date(year, m, 0).getDate();
  return `${year}-${pad2(m)}-${pad2(Math.min(d ?? lastDay, lastDay))}`;
}

/*
 * Lease durations, matched against unit_leases.lease_term_months, the array of
 * every term a landlord will accept, so [6,10,12] is one flexible offering that
 * satisfies "6-month", "10-month" AND "12-month". A duration is "<n>-month"
 * for any number of months. "summer" and "semester" are the older buckets,
 * still offered by the app's filter sheet and held by saved filters.
 */
const LEGACY_TERM_BUCKETS = {
  summer: (m) => m <= 3,
  semester: (m) => m >= 4 && m <= 6,
};
/*
 * Ranges, set by Find Your Place's "Browse All Matches" so browse keeps the
 * same lease buckets the matcher used: semester up to 7 months, academic year
 * 8 to 10, full year 11 or more. The one copy: the web's filterListings reads
 * it from here (PR 447 review).
 */
export const TERM_RANGES = {
  "semester-term": { label: "Semester (up to 7 months)", order: 7, test: (m) => m <= 7 },
  "academic-year": { label: "Academic Year (8 to 10 months)", order: 9, test: (m) => m >= 8 && m <= 10 },
  "full-year": { label: "Full Year (11+ months)", order: 11, test: (m) => m >= 11 },
};
const termBucket = (key) => {
  const months = /^(\d+)-month$/.exec(key);
  if (months) return (m) => m === Number(months[1]);
  return TERM_RANGES[key]?.test ?? LEGACY_TERM_BUCKETS[key];
};

// ---------------------------------------------------------------------------
// Lease scope
// ---------------------------------------------------------------------------

/** True when this single offering satisfies every lease-scoped filter. */
export function leaseMatches(lease, filters) {
  // Price. A null rent is "ask the landlord", not "free" and not "expensive" -
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
        const inBucket = termBucket(key);
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

  // "Move in in August": the offering must be open by the end of the next
  // August (with a day, by that day of it). No stated date is not a late one.
  // Compared as date text, not Dates, so a time zone cannot move it a day.
  if (filters.moveInMonth) {
    const opens = String(lease.availableFrom ?? "").slice(0, 10);
    const deadline = moveInDeadline(filters.moveInMonth, filters.moveInDay);
    if (deadline && /^\d{4}-\d{2}-\d{2}$/.test(opens) && opens > deadline) {
      return false;
    }
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
 * move-in, so it is not a match for those.
 */
function categoricalLeaseFilters(filters) {
  return !!(
    filters.furnished ||
    filters.subleaseOnly ||
    filters.moveInDate ||
    filters.moveInMonth ||
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
 * shape instead of vanishing, browse has never hidden those.
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

  // No live offering at all, the unit is real, its terms simply aren't
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

// Canonical filter value → every DB value that means it (snake_case + legacy
// ALL_CAPS). The feed names amenities after the listing_amenities columns
// (laundry, air_conditioning, storage, parking), which four of the filter's
// values did not include, so those four matched nothing.
const AMENITY_ALIASES = {
  dishwasher: ["dishwasher", "DISHWASHER"],
  in_unit_laundry: ["laundry", "in_unit_laundry", "IN-UNIT LAUNDRY", "IN UNIT LAUNDRY"],
  ac_heating: ["air_conditioning", "ac_heating"],
  mailroom: ["mailroom", "MAILROOM"],
  pets_allowed: ["pets_allowed", "PETS ALLOWED"],
  extra_storage: ["storage", "extra_storage", "EXTRA STORAGE"],
  fireplace: ["fireplace", "FIREPLACE"],
  private_parking: ["parking", "private_parking", "FREE PARKING"],
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
        // Shape questions rather than building types (no listing has a Studio
        // or Single Room home type), answered from the units themselves: a
        // studio is a 0-bedroom unit, a single room a 1-bedroom one.
        case "studio":
          return unitPool(listing).some((u) => u.bedrooms === 0);
        case "single_room":
        // The older name for a single room, which the app's filter sheet
        // still offers and saved filters still hold.
        case "singleBedroom":
          return unitPool(listing).some((u) => u.bedrooms === 1);
        // A building type: the listing's home type label, which has to be the
        // whole word ("townhouse" contains "house").
        default:
          return lt === type;
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

  // "Allows subletting", a property policy, unlike subleaseOnly which asks
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
     * filters on, every unit "matches" and the cheapest would win, which would
     * silently override the panel's own smallest-unit-first tab order for plain
     * browsing.
     */
    matchedUnitId: narrowed ? best.unit.id ?? null : null,
    priceUnknown: !best.priceKnown,
  };
}

/**
 * The rents the price histogram draws: one per available listing that fits
 * every filter except the price range itself (so the bars show where the
 * places a renter is looking for sit, inside the range and outside it), at
 * its cheapest offering that fits. A listing with no published rent on a
 * fitting offering has no bar to be in.
 */
export function fittingRents(listings, { filters, search = "", savedIds = [], campusMinutes }) {
  const open = { ...filters, minRent: "", maxRent: "" };
  const ctx = { filters: open, search, savedIds, campusMinutes };
  return listings.flatMap((listing) => {
    if (listing.unavailable || !propertyMatches(listing, ctx)) return [];
    const rents = unitPool(listing)
      .map((u) => unitMatch(u, open))
      .filter((m) => m?.priceKnown)
      .map((m) => m.lease.rent);
    return rents.length ? [Math.min(...rents)] : [];
  });
}

/**
 * Filter and rank the browse feed.
 *
 * `campusMinutes(listing)` is injected rather than imported so this module stays
 * free of the WashU place list and can be unit-tested on plain objects.
 */
export function filterListings(
  listings,
  { filters, search = "", savedIds = [], campusMinutes = defaultCampusMinutes }
) {
  const ctx = { filters, search, savedIds, campusMinutes };
  const priceFilterOn = !!(filters.minRent || filters.maxRent);

  return listings
    .map((l) => matchListing(l, ctx))
    .filter(Boolean)
    .sort((a, b) => {
      // 0) Only while a price filter is engaged: listings whose price is simply
      //    unpublished sink below the ones that provably fit the range. They are
      //    still shown, a renter can ask, just never ahead of a real match.
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

/**
 * Final Browse ordering, as web's AvailableListings does it: unavailable
 * (greyed-out) listings last, everything else keeps the order filterListings
 * ranked it in. Array.prototype.sort is stable, so ties are untouched.
 */
export function rankBrowseListings(listings) {
  return [...listings].sort((a, b) => (a.unavailable ? 1 : 0) - (b.unavailable ? 1 : 0));
}

export function countActiveFilters(filters) {
  let count = 0;
  if (filters.minRent) count++;
  if (filters.maxRent) count++;
  if (filters.bedrooms) count++;
  if (filters.maxBedrooms) count++;
  if (filters.bathrooms) count++;
  if (filters.maxBathrooms) count++;
  if (filters.distance) count++;
  if (filters.distanceToShuttle) count++;
  if (filters.moveInDate) count++;
  if (filters.moveInMonth) count++;
  count += filters.homeType?.length ?? 0;
  count += filters.leaseAvailability?.length ?? 0;
  count += filters.amenities?.length ?? 0;
  if (filters.furnished) count++;
  count += filters.utilitiesIncluded?.length ?? 0;
  if (filters.subleaseFriendly) count++;
  if (filters.subleaseOnly) count++;
  if (filters.leaseStructure) count++;
  if (filters.savedOnly) count++;
  return count;
}
