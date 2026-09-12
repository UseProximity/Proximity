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
 * rentBasis, reviewStats }. See model.js for how it is built.
 *
 * `better` says which direction is objectively preferable when both sides are
 * known: "lower" (rent, walk minutes), "higher" (area, rating). Rows with no
 * direction are preference facts and never get a highlight.
 */

import { availabilityLabel } from "@/utils/availability";
import { durationLabel } from "@/components/listings/LeaseOptions";
import { NON_CAMPUS_WALK_PLACES } from "@/utils/washuPlaces";

export const CAMPUS_DESTINATION = "Danforth University Center";

const walk = (name) => (ctx) => ctx.listing.placeWalkMinutes?.[name] ?? null;
const amenity = (key) => (ctx) => ctx.listing.amenities?.includes(key) || null;
const utility = (key) => (ctx) => ctx.listing.utilitiesIncluded?.includes(key) || null;

/*
 * Walk to the campus the student actually commutes to. Danforth is the
 * closest main-campus point (the browse card's figure); the Med Campus is its
 * own destination two miles east, so a student there gets that number instead.
 */
export function campusWalkFor(listing, campus) {
  const pwm = listing?.placeWalkMinutes;
  if (!pwm) return null;
  if (campus === "med") return pwm["Med Campus"] ?? null;
  const vals = Object.entries(pwm)
    .filter(([k]) => !NON_CAMPUS_WALK_PLACES.includes(k))
    .map(([, v]) => v)
    .filter(Number.isFinite);
  return vals.length ? Math.min(...vals) : null;
}

export const campusLabel = (campus) => (campus === "med" ? "Med Campus" : "Danforth");

const campusWalk = (ctx) => campusWalkFor(ctx.listing, ctx.campus);

// Room counts below zero came from a spinner bug on old rows; read them as unknown.
const count = (n) => (Number.isFinite(n) && n >= 0 ? n : null);

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
        suffix: (ctx) => (ctx.basis === "unit" ? "/ apartment" : "/ person"),
      },
      { id: "campusWalk", label: (ctx) => `Walk to ${campusLabel(ctx?.campus)}`, type: "minutes", better: "lower", get: campusWalk },
      {
        id: "shuttleWalkTop",
        label: "Walk to nearest shuttle stop",
        type: "minutes",
        better: "lower",
        get: (ctx) => ctx.listing.shuttleWalkMinutes ?? null,
      },
      { id: "bedrooms", label: "Bedrooms", type: "count", get: (ctx) => count(ctx.unit?.bedrooms),
        format: (v) => (v === 0 ? "Studio" : String(v)) },
      { id: "bathrooms", label: "Bathrooms", type: "count", get: (ctx) => count(ctx.unit?.bathrooms) },
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
        format: (v, ctx) => `${v.toFixed(1)} · ${ctx.listing.numReviews} review${ctx.listing.numReviews === 1 ? "" : "s"}`,
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
        note: (ctx) =>
          ctx.rentBasis?.basis === "person" && ctx.rentBasis.beds > 1 && ctx.basis !== "unit"
            ? `${ctx.rentBasis.beds} people`
            : null,
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
      {
        id: "rentEstimated",
        label: "Rent basis",
        type: "text",
        get: (ctx) => {
          if (!ctx.rentBasis) return null;
          const stated = ctx.lease?.rentIsPerPerson;
          if (stated === true) return "Per person, stated by landlord";
          if (stated === false) return "Whole apartment, stated by landlord";
          return ctx.rentBasis.basis === "person" ? "Per person (our estimate)" : "Whole apartment (our estimate)";
        },
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
      { id: "ducWalk", label: CAMPUS_DESTINATION, type: "minutes", better: "lower", get: walk(CAMPUS_DESTINATION) },
      { id: "olinWalk", label: "Olin Library", type: "minutes", better: "lower", get: walk("Olin Library") },
      { id: "seigleWalk", label: "Seigle Hall", type: "minutes", better: "lower", get: walk("Seigle Hall") },
      { id: "recWalk", label: "Sumers Rec Center", type: "minutes", better: "lower", get: walk("Sumers Rec Center") },
      { id: "villageWalk", label: "Village House", type: "minutes", better: "lower", get: walk("Village House") },
      { id: "medWalk", label: "Med Campus", type: "minutes", better: "lower", get: walk("Med Campus") },
      { id: "groceryWalk", label: "Schnucks", type: "minutes", better: "lower", get: walk("Schnucks (Grocery)") },
      {
        id: "loopDrive",
        label: "Drive to the Delmar Loop",
        type: "minutes",
        better: "lower",
        get: (ctx) => ctx.listing.placeDriveMinutes?.["Delmar Loop"] ?? null,
      },
      {
        id: "forestParkDrive",
        label: "Drive to Forest Park",
        type: "minutes",
        better: "lower",
        get: (ctx) => ctx.listing.placeDriveMinutes?.["Forest Park (Skinker Entrance)"] ?? null,
      },
      {
        id: "groceryDrive",
        label: "Drive to the nearest Schnucks",
        type: "minutes",
        better: "lower",
        get: (ctx) => ctx.listing.placeDriveMinutes?.schnucks_nearest ?? null,
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
    label: "Your space",
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
          const beds = ctx.unit?.bedrooms;
          if (area == null || beds == null) return null;
          return Math.round(area / Math.max(beds, 1));
        },
      },
      { id: "airConditioning", label: "Air conditioning", type: "boolean", get: amenity("air_conditioning") },
      { id: "laundry", label: "Laundry", type: "boolean", get: amenity("laundry") },
      { id: "storage", label: "Extra storage", type: "boolean", get: amenity("storage") },
      {
        id: "floorPlan",
        label: "Floor plan",
        type: "link",
        get: (ctx) => ctx.unit?.floorPlanImageUrl ?? null,
        format: () => "View floor plan",
      },
      {
        id: "unitPhotos",
        label: "Photos of this unit",
        type: "count",
        get: (ctx) => (ctx.unit?.images?.length ? ctx.unit.images.length : null),
      },
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
        id: "landlord",
        label: "Who you'd be talking to",
        type: "text",
        get: (ctx) => ctx.lease?.landlordName ?? ctx.listing.contactName ?? ctx.listing.owner?.name ?? null,
      },
      {
        id: "offerCount",
        label: "Offers on this unit",
        type: "count",
        get: (ctx) => (ctx.unit?.leases?.length > 1 ? ctx.unit.leases.length : null),
      },
    ],
  },
  {
    id: "amenities",
    label: "Amenities",
    fields: [
      { id: "gym", label: "Gym", type: "boolean", get: amenity("gym") },
      { id: "studyRoom", label: "Study room", type: "boolean", get: amenity("study_room") },
      { id: "pool", label: "Pool", type: "boolean", get: amenity("pool") },
      { id: "rooftop", label: "Rooftop", type: "boolean", get: amenity("rooftop") },
      { id: "parking", label: "Parking", type: "boolean", get: amenity("parking") },
      { id: "petsAllowed", label: "Pets allowed", type: "boolean", get: amenity("pets_allowed") },
      { id: "mailroom", label: "Mailroom", type: "boolean", get: amenity("mailroom") },
      { id: "dishwasher", label: "Dishwasher", type: "boolean", get: amenity("dishwasher") },
      { id: "microwave", label: "Microwave", type: "boolean", get: amenity("microwave") },
      { id: "oven", label: "Oven", type: "boolean", get: amenity("oven") },
      { id: "stove", label: "Stove", type: "boolean", get: amenity("stove") },
      { id: "refrigerator", label: "Refrigerator", type: "boolean", get: amenity("refrigerator") },
      {
        id: "customAmenities",
        label: "Also listed",
        type: "list",
        get: (ctx) => (ctx.listing.customAmenities?.length ? ctx.listing.customAmenities : null),
      },
    ],
  },
  {
    id: "utilities",
    label: "Utilities included",
    fields: [
      { id: "electric", label: "Electric", type: "boolean", get: utility("electric") },
      { id: "water", label: "Water", type: "boolean", get: utility("water") },
      { id: "internet", label: "Internet", type: "boolean", get: utility("internet") },
      { id: "gas", label: "Gas", type: "boolean", get: utility("gas") },
      { id: "heat", label: "Heat", type: "boolean", get: utility("heat") },
      { id: "cooling", label: "Cooling", type: "boolean", get: utility("cooling") },
      { id: "trash", label: "Trash", type: "boolean", get: utility("trash") },
      { id: "sewer", label: "Sewer", type: "boolean", get: utility("sewer") },
      { id: "cable", label: "Cable", type: "boolean", get: utility("cable") },
    ],
  },
  {
    id: "reviews",
    label: "Student reviews",
    fields: [
      { id: "communication", label: "Landlord communication", type: "rating", better: "higher", get: (ctx) => ctx.reviewStats.communication },
      { id: "location", label: "Location", type: "rating", better: "higher", get: (ctx) => ctx.reviewStats.location },
      { id: "value", label: "Value for money", type: "rating", better: "higher", get: (ctx) => ctx.reviewStats.value },
      { id: "latestReview", label: "Most recent review", type: "text", get: (ctx) => ctx.reviewStats.latest },
      {
        id: "quote",
        label: "What a student said",
        type: "quote",
        get: (ctx) => ctx.reviewStats.quote,
      },
    ],
  },
  {
    id: "practical",
    label: "Practical details",
    fields: [
      { id: "photos", label: "Photos", type: "count", get: (ctx) => ctx.listing.allImages?.length || ctx.listing.images?.length || null },
      {
        id: "verifiedAt",
        label: "Last verified",
        type: "date",
        get: (ctx) => ctx.listing.verifiedAt ?? null,
      },
      { id: "listedSince", label: "On Proximity since", type: "date", get: (ctx) => ctx.listing.createdAt ?? null },
      { id: "address", label: "Address", type: "text", get: (ctx) => ctx.listing.address ?? null },
    ],
  },
];

export const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields.map((f) => ({ ...f, section: s.id })));
