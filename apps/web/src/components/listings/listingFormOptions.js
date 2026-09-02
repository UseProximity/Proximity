/*
 * Shared option lists for the add-listing flows (add/, wizard/) and the
 * property editor (editor/). Amenity/utility values are the exact boolean column
 * names on `listing_amenities` / `listing_utilities` — the API writes
 * `row[name] = true` for each, so anything not listed here is dropped.
 */
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
  // A card describes a FLOOR PLAN; these say which physical units share it.
  // designator + each number becomes one listing_units row with its own lease,
  // which is what lets a second landlord attach to the right unit later.
  designator: "",
  unitNumbers: "",
});

// Unit designators, matching listing_units_designator_check.
export const UNIT_DESIGNATORS = ["Apt", "Unit", "Suite", "Floor", "Room", "Whole"];

/*
 * Parse the "which units?" field into a de-duplicated list of unit numbers.
 * Accepts commas, whitespace and hyphen ranges over trailing integers, so
 * "2W, 3W" and "1-4" both work. "Whole" covers the entire property and has no
 * numbers, so it always yields a single unnumbered unit.
 */
export function parseUnitNumbers(designator, raw) {
  if (designator === "Whole") return [null];
  const text = String(raw ?? "").trim();
  if (!text) return [];

  const out = [];
  for (const token of text.split(/[,\s]+/).filter(Boolean)) {
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      // Guard against a typo like "1-9999" silently creating thousands of units.
      if (from <= to && to - from < 200) {
        for (let n = from; n <= to; n++) out.push(String(n));
        continue;
      }
    }
    out.push(token.toUpperCase());
  }
  return Array.from(new Set(out));
}
