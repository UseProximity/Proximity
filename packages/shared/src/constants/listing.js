// Ported from apps/web/src/components/listings/listingFormOptions.js — the
// shared option-list source for the add-listing wizard (AddListingWizard.js)
// and its edit-form counterpart (ListingFormPanel.js). Keep in sync with that
// file; SubleaseFormPanel.js (a separate, unrelated student-sublease form)
// keeps its own diverged inline copies and is intentionally not reconciled
// here.
//
// Values are the exact boolean column names on `listing_amenities` /
// `listing_utilities` — the API writes `row[name] = true` for each, so
// anything not in these lists is dropped.

export const AMENITY_OPTIONS = [
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
];

export const AMENITY_LABELS = {
  air_conditioning: "Air Conditioning",
  dishwasher: "Dishwasher",
  gym: "Gym",
  laundry: "Laundry",
  mailroom: "Mailroom",
  microwave: "Microwave",
  oven: "Oven",
  parking: "Parking",
  pets_allowed: "Pets Allowed",
  pool: "Pool",
  refrigerator: "Refrigerator",
  rooftop: "Rooftop",
  storage: "Storage",
  stove: "Stove",
  study_room: "Study Room",
};

export const UTILITY_OPTIONS = [
  "electric",
  "gas",
  "heat",
  "water",
  "internet",
  "trash",
  "cable",
  "sewer",
  "cooling",
];

export const UTILITY_LABELS = {
  electric: "Electric",
  gas: "Gas",
  heat: "Heat",
  water: "Water",
  internet: "Internet",
  trash: "Trash",
  cable: "Cable",
  sewer: "Sewer",
  cooling: "Cooling",
};

export const HOME_TYPES = ["apartment", "house", "condo", "townhouse", "other"];

export const LEASE_TYPES = ["standard", "sublease", "short-term"];

// Named lease-term presets map to month counts; landlords can also type any number.
export const LEASE_TERM_PRESETS = [
  { label: "Summer", months: 4 },
  { label: "Semester", months: 5 },
  { label: "10-Month", months: 10 },
  { label: "12-Month", months: 12 },
];

export const emptyUnit = () => ({
  bedrooms: "",
  bathrooms: "",
  rent: "",
  area: "",
  available: true,
  title: "",
  floorPlanImageUrl: "",
  leaseTermMonths: [], // months a unit can be leased for (multi-select)
});
