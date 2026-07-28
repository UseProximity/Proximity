import { WASHU_PLACES, NON_CAMPUS_WALK_PLACES } from "../constants/places.js";

// Ported verbatim from apps/web/src/components/listings/BrowseContent.js's
// filteredListings predicate. savedOnly is kept in the shape for parity, but
// mobile has no favorites UI yet (Phase 6) — pass savedIds when that lands.
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

// Canonical filter-chip amenity values are a distinct, smaller vocabulary
// from packages/shared's AMENITY_OPTIONS (which mirrors the DB columns) —
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

export function filterListings(listings, filters, { search = "", savedIds = [] } = {}) {
  return listings.filter((listing) => {
    const lt = listing?.homeType?.toLowerCase() || "";
    const desc = listing?.description?.toLowerCase() || "";
    const amenitiesText = (listing?.amenities || []).join(" ").toLowerCase();
    const combined = desc + " " + amenitiesText;

    const q = search.toLowerCase();
    const matchSearch =
      !q || listing?.address?.toLowerCase().includes(q) || listing?.title?.toLowerCase().includes(q);

    const matchMinRent = !filters.minRent || listing?.maxRent >= Number(filters.minRent);
    const matchMaxRent = !filters.maxRent || listing?.minRent <= Number(filters.maxRent);

    const matchBeds =
      (!filters.bedrooms || listing?.maxBedrooms >= Number(filters.bedrooms)) &&
      (!filters.maxBedrooms || listing?.minBedrooms <= Number(filters.maxBedrooms));
    const matchBaths =
      (!filters.bathrooms || listing?.maxBathrooms >= Number(filters.bathrooms)) &&
      (!filters.maxBathrooms || listing?.minBathrooms <= Number(filters.maxBathrooms));

    let matchDistance = true;
    if (filters.distance) {
      const maxMinutes = parseFloat(filters.distance);
      const pwm = listing.placeWalkMinutes;
      const campusMins = WASHU_PLACES.filter((p) => !NON_CAMPUS_WALK_PLACES.includes(p.name))
        .map((p) => pwm?.[p.name])
        .filter((m) => m != null);
      matchDistance = campusMins.length > 0 && Math.min(...campusMins) <= maxMinutes;
    }

    let matchShuttle = true;
    if (filters.distanceToShuttle) {
      const maxMinutes = parseFloat(filters.distanceToShuttle);
      matchShuttle = listing.shuttleWalkMinutes != null && listing.shuttleWalkMinutes <= maxMinutes;
    }

    let matchHomeType = true;
    if (filters.homeType && filters.homeType.length > 0) {
      matchHomeType = filters.homeType.some((type) => {
        switch (type) {
          case "house":
            return lt.includes("house");
          case "apartment":
            return lt.includes("apartment");
          case "condo":
            return lt.includes("condo");
          case "townhouse":
            return lt.includes("townhouse");
          case "singleBedroom":
            return listing?.minBedrooms === 1;
          default:
            return true;
        }
      });
    }

    let matchLeaseAvail = true;
    if (filters.leaseAvailability && filters.leaseAvailability.length > 0) {
      const la = Array.isArray(listing?.leaseAvailability) ? listing.leaseAvailability : [];
      matchLeaseAvail = filters.leaseAvailability.some((avail) => {
        switch (avail) {
          case "semester":
            return la.includes("semester") || desc.includes("semester");
          case "10-month":
            return la.includes("10-month") || desc.includes("10 month") || desc.includes("10-month");
          case "12-month":
            return la.includes("12-month") || desc.includes("12 month") || desc.includes("12-month");
          case "summer":
            return la.includes("summer") || desc.includes("summer");
          default:
            return true;
        }
      });
    }

    let matchAmenities = true;
    if (filters.amenities && filters.amenities.length > 0) {
      const arr = listing.amenities || [];
      matchAmenities = filters.amenities.every((amenity) => {
        const aliases = AMENITY_ALIASES[amenity] ?? [amenity];
        return aliases.some((v) => arr.includes(v));
      });
    }

    let matchFurnished = true;
    if (filters.furnished === "furnished") {
      matchFurnished = listing?.furnished === true || (combined.includes("furnished") && !combined.includes("unfurnished"));
    } else if (filters.furnished === "unfurnished") {
      matchFurnished = listing?.furnished === false || combined.includes("unfurnished") || !combined.includes("furnished");
    }

    let matchUtilities = true;
    if (filters.utilitiesIncluded?.length > 0) {
      const listingUtils = Array.isArray(listing?.utilitiesIncluded) ? listing.utilitiesIncluded : [];
      matchUtilities = filters.utilitiesIncluded.every((u) => listingUtils.includes(u));
    }

    let matchSublease = true;
    if (filters.subleaseFriendly) {
      matchSublease = listing?.subleaseFriendly === true || desc.includes("subleas") || desc.includes("subletting allowed");
    }

    let matchSubleaseOnly = true;
    if (filters.subleaseOnly) {
      matchSubleaseOnly = String(listing?.leaseType ?? "").toLowerCase() === "sublease";
    }

    let matchLeaseStructure = true;
    if (filters.leaseStructure === "individual") {
      matchLeaseStructure =
        listing?.leaseStructure === "individual" || desc.includes("individual lease") || desc.includes("by the room");
    } else if (filters.leaseStructure === "joint") {
      matchLeaseStructure = listing?.leaseStructure === "joint" || desc.includes("joint lease") || desc.includes("whole unit");
    }

    const matchSaved = !filters.savedOnly || savedIds.includes(String(listing._id));

    let matchMoveInDate = true;
    if (filters.moveInDate) {
      const desiredDate = new Date(filters.moveInDate);
      const listingMoveInDate = new Date(listing.moveInDate);
      matchMoveInDate = isNaN(listingMoveInDate.getTime()) || listingMoveInDate <= desiredDate;
    }

    return (
      matchSearch &&
      matchMinRent &&
      matchMaxRent &&
      matchBeds &&
      matchBaths &&
      matchDistance &&
      matchShuttle &&
      matchHomeType &&
      matchLeaseAvail &&
      matchAmenities &&
      matchFurnished &&
      matchUtilities &&
      matchSublease &&
      matchSubleaseOnly &&
      matchLeaseStructure &&
      matchMoveInDate &&
      matchSaved
    );
  });
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
