// Ported from apps/web/src/components/listings/ListingFormPanel.js and
// SubleaseFormPanel.js — the two files diverged slightly (ListingFormPanel
// omits "studio" from HOME_TYPES; the two LEASE_TYPES arrays differ only in
// order). Reconciled here as the union/canonical set. AMENITY_OPTIONS/LABELS
// and UTILITY_OPTIONS/LABELS were identical in both files.
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

export const HOME_TYPES = ["apartment", "house", "condo", "townhouse", "studio", "other"];

export const LEASE_TYPES = ["standard", "sublease", "short-term"];
