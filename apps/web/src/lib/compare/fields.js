/*
 * The comparison field registry.
 *
 * One entry per row the /compare page can show, grouped into the sections a
 * student scrolls through. The page renders a row only when at least one of
 * the two properties has a value for it, so adding a field here is safe even
 * when the database holds nothing for it yet: the row stays hidden until the
 * first listing fills it in, then appears on its own.
 *
 * `get(ctx)` returns the raw value (or null when unknown). `ctx` is the
 * adapter's view of one side of the comparison: { listing, unit, lease, basis,
 * campus, rentBasis, reviewStats }. See model.js for how it is built.
 *
 * `better` says which direction is objectively preferable when both sides are
 * known: "lower" (rent, walk minutes), "higher" (area, rating). Rows with no
 * direction are preference facts and never get a highlight.
 *
 * Kept deliberately short (Wyatt, 2026-09-12): one campus point rather than
 * every building, amenities and utilities as lists rather than a row each.
 */

import { availabilityLabel } from "@/utils/availability";
import { durationLabel } from "@/components/listings/LeaseOptions";

export const CAMPUS_DESTINATION = "Danforth University Center";

/*
 * Walk to the campus the student actually commutes to. One point per campus:
 * the Danforth University Center for the main campus, the Med Campus for the
 * medical school. Every walk on the page goes to the same place.
 */
export function campusWalkFor(listing, campus) {
  const pwm = listing?.placeWalkMinutes;
  if (!pwm) return null;
  return (campus === "med" ? pwm["Med Campus"] : pwm[CAMPUS_DESTINATION]) ?? null;
}

export const campusLabel = (campus) => (campus === "med" ? "Med Campus" : "Danforth");

const campusWalk = (ctx) => campusWalkFor(ctx.listing, ctx.campus);

// Room counts below zero came from a spinner bug on old rows; read them as unknown.
const count = (n) => (Number.isFinite(n) && n >= 0 ? n : null);

const AMENITY_LABELS = {
  air_conditioning: "Air conditioning",
  dishwasher: "Dishwasher",
  gym: "Gym",
  laundry: "Laundry",
  mailroom: "Mailroom",
  microwave: "Microwave",
  oven: "Oven",
  parking: "Parking",
  pets_allowed: "Pets allowed",
  pool: "Pool",
  refrigerator: "Refrigerator",
  rooftop: "Rooftop",
  storage: "Storage",
  stove: "Stove",
  study_room: "Study room",
};
const BUILDING_AMENITIES = ["gym", "study_room", "pool", "rooftop", "parking", "pets_allowed", "mailroom", "storage"];
const UNIT_AMENITIES = ["air_conditioning", "laundry", "dishwasher", "microwave", "oven", "stove", "refrigerator"];
const UTILITY_LABELS = {
  electric: "Electric",
  water: "Water",
  internet: "Internet",
  gas: "Gas",
  heat: "Heat",
  cooling: "Cooling",
  trash: "Trash",
  sewer: "Sewer",
  cable: "Cable",
};

const amenityList = (keys) => (ctx) => {
  const have = keys.filter((k) => ctx.listing.amenities?.includes(k)).map((k) => AMENITY_LABELS[k]);
  return have.length ? have : null;
};

export const SECTIONS = [
  {
    id: "essentials",
    label: "Essentials",
    fields: [
      {
        id: "rent",
        label: "Rent",
        type: "money",
        better: "lower",
        get: (ctx) =>
          ctx.rentBasis
            ? ctx.basis === "unit"
              ? ctx.rentBasis.unitRent
              : ctx.rentBasis.perPerson
            : null,
        suffix: (ctx) => (ctx.basis === "unit" ? "/ apt" : "/ person"),
      },
      { id: "campusWalk", label: (ctx) => `Walk to ${campusLabel(ctx?.campus)}`, type: "minutes", better: "lower", get: campusWalk },
      {
        id: "bedBath",
        label: "Bed / bath",
        type: "text",
        get: (ctx) => {
          const b = count(ctx.unit?.bedrooms);
          const ba = count(ctx.unit?.bathrooms);
          if (b == null && ba == null) return null;
          return [b == null ? null : b === 0 ? "Studio" : `${b} bed`, ba == null ? null : `${ba} bath`].filter(Boolean).join(" · ");
        },
      },
      { id: "area", label: "Size", type: "area", better: "higher", get: (ctx) => ctx.unit?.area ?? null },
      {
        id: "furnished",
        label: "Furnished",
        type: "boolean",
        get: (ctx) => ctx.lease?.furnished ?? ctx.listing.furnished ?? null,
      },
      {
        id: "moveIn",
        label: "Move-in",
        type: "text",
        get: (ctx) => (ctx.lease?.availableFrom ? availabilityLabel(ctx.lease.availableFrom).text : null),
      },
      {
        id: "term",
        label: "Lease length",
        type: "text",
        get: (ctx) => durationLabel(ctx.lease?.leaseTermMonths),
      },
      {
        id: "rating",
        label: "Student rating",
        type: "rating",
        better: "higher",
        get: (ctx) => (ctx.listing.numReviews > 0 ? ctx.listing.rating : null),
        format: (v, ctx) => `${v.toFixed(1)} (${ctx.listing.numReviews})`,
      },
    ],
  },
  {
    id: "costs",
    label: "Costs",
    fields: [
      {
        id: "rentOtherBasis",
        label: (ctx) => (ctx.basis === "unit" ? "Rent per person" : "Rent for the whole apartment"),
        type: "money",
        better: "lower",
        get: (ctx) =>
          ctx.rentBasis
            ? ctx.basis === "unit"
              ? ctx.rentBasis.perPerson
              : ctx.rentBasis.unitRent
            : null,
        note: (ctx) => {
          const stated = ctx.lease?.rentIsPerPerson;
          if (stated == null && ctx.rentBasis && ctx.rentBasis.beds > 1) return "estimated";
          return null;
        },
      },
      {
        id: "termTotal",
        label: "Rent over the lease",
        type: "money",
        better: "lower",
        // Only when the offer has a single term. Two terms would be two totals,
        // and a range would imply every month in between is on offer.
        get: (ctx) => {
          const months = ctx.lease?.leaseTermMonths ?? [];
          const rent = ctx.rentBasis ? (ctx.basis === "unit" ? ctx.rentBasis.unitRent : ctx.rentBasis.perPerson) : null;
          if (rent == null || months.length !== 1) return null;
          return rent * months[0];
        },
        note: (ctx) => (ctx.lease?.leaseTermMonths?.length === 1 ? `${ctx.lease.leaseTermMonths[0]} months` : null),
      },
      // Not collected yet. They appear the day the columns exist.
      { id: "deposit", label: "Security deposit", type: "money", get: () => null },
      { id: "applicationFee", label: "Application fee", type: "money", get: () => null },
      { id: "parkingCost", label: "Parking per month", type: "money", get: () => null },
      { id: "petRent", label: "Pet rent", type: "money", get: () => null },
    ],
  },
  {
    id: "commute",
    label: "Getting around",
    fields: [
      {
        id: "shuttleWalk",
        label: "Walk to nearest shuttle stop",
        type: "minutes",
        better: "lower",
        get: (ctx) => ctx.listing.shuttleWalkMinutes ?? null,
      },
      {
        id: "otherCampusWalk",
        label: (ctx) => (ctx?.campus === "med" ? "Walk to Danforth" : "Walk to Med Campus"),
        type: "minutes",
        better: "lower",
        get: (ctx) => campusWalkFor(ctx.listing, ctx.campus === "med" ? "danforth" : "med"),
      },
      { id: "groceryWalk", label: "Walk to Schnucks", type: "minutes", better: "lower", get: (ctx) => ctx.listing.placeWalkMinutes?.["Schnucks (Grocery)"] ?? null },
      {
        id: "loopDrive",
        label: "Drive to the Delmar Loop",
        type: "minutes",
        better: "lower",
        get: (ctx) => ctx.listing.placeDriveMinutes?.["Delmar Loop"] ?? null,
      },
      {
        id: "airportDrive",
        label: "Drive to Lambert Airport",
        type: "minutes",
        better: "lower",
        get: (ctx) => ctx.listing.placeDriveMinutes?.["Lambert Airport"] ?? null,
      },
    ],
  },
  {
    id: "space",
    label: "The apartment",
    fields: [
      {
        id: "unitName",
        label: "Unit",
        type: "text",
        get: (ctx) => ctx.unit?.identityLabel ?? ctx.unit?.title ?? null,
      },
      { id: "homeType", label: "Property type", type: "text", get: (ctx) => (ctx.listing.homeType && ctx.listing.homeType !== "Other" ? ctx.listing.homeType : null) },
      {
        id: "areaPerPerson",
        label: "Space per person",
        type: "area",
        better: "higher",
        get: (ctx) => {
          const area = ctx.unit?.area;
          const beds = count(ctx.unit?.bedrooms);
          if (area == null || beds == null) return null;
          return Math.round(area / Math.max(beds, 1));
        },
      },
      {
        id: "floorPlan",
        label: "Floor plan",
        type: "link",
        get: (ctx) => ctx.unit?.floorPlanImageUrl ?? null,
        format: () => "View floor plan",
      },
      { id: "unitAmenities", label: "In the apartment", type: "list", get: amenityList(UNIT_AMENITIES) },
    ],
  },
  {
    id: "building",
    label: "Building",
    fields: [
      { id: "buildingAmenities", label: "Amenities", type: "list", get: amenityList(BUILDING_AMENITIES) },
      {
        id: "customAmenities",
        label: "Also listed",
        type: "list",
        get: (ctx) => (ctx.listing.customAmenities?.length ? ctx.listing.customAmenities : null),
      },
      {
        id: "utilities",
        label: "Utilities included",
        type: "list",
        get: (ctx) => {
          const have = Object.keys(UTILITY_LABELS).filter((k) => ctx.listing.utilitiesIncluded?.includes(k)).map((k) => UTILITY_LABELS[k]);
          return have.length ? have : null;
        },
      },
      { id: "photos", label: "Photos", type: "count", get: (ctx) => ctx.listing.allImages?.length || ctx.listing.images?.length || null },
    ],
  },
  {
    id: "lease",
    label: "Lease",
    fields: [
      {
        id: "leaseType",
        label: "Lease type",
        type: "text",
        get: (ctx) => (ctx.lease ? (ctx.lease.sublease ? "Sublease" : "Standard lease") : null),
      },
      {
        id: "structure",
        label: "Lease structure",
        type: "text",
        get: (ctx) =>
          ctx.listing.leaseStructure === "individual"
            ? "Individual (each roommate signs their own)"
            : ctx.listing.leaseStructure === "joint"
            ? "Joint (everyone signs one lease)"
            : null,
      },
      {
        id: "subleaseFriendly",
        label: "Subletting allowed",
        type: "boolean",
        get: (ctx) => ctx.listing.subleaseFriendly || null,
      },
      {
        id: "twentyOnePlus",
        label: "21+ only",
        type: "boolean",
        get: (ctx) => ctx.listing.twentyOnePlus || null,
      },
      {
        id: "verifiedLive",
        label: "Availability synced from landlord's system",
        type: "boolean",
        get: (ctx) => ctx.listing.verifiedLive || null,
      },
      {
        id: "verifiedAt",
        label: "Last verified",
        type: "date",
        get: (ctx) => ctx.listing.verifiedAt ?? null,
      },
      {
        id: "landlord",
        label: "Who you'd be talking to",
        type: "text",
        get: (ctx) => ctx.lease?.landlordName ?? ctx.listing.contactName ?? ctx.listing.owner?.name ?? null,
      },
      { id: "address", label: "Address", type: "text", get: (ctx) => ctx.listing.address ?? null },
    ],
  },
  {
    id: "reviews",
    label: "Student reviews",
    fields: [
      { id: "communication", label: "Landlord communication", type: "rating", better: "higher", get: (ctx) => ctx.reviewStats.communication },
      { id: "location", label: "Location", type: "rating", better: "higher", get: (ctx) => ctx.reviewStats.location },
      { id: "value", label: "Value for money", type: "rating", better: "higher", get: (ctx) => ctx.reviewStats.value },
      {
        id: "quote",
        label: "What a student said",
        type: "quote",
        get: (ctx) => ctx.reviewStats.quote,
      },
    ],
  },
];

export const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields.map((f) => ({ ...f, section: s.id })));
