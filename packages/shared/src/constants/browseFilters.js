import { TERM_RANGES } from "../formatters/listingFilters.js";

/*
 * What each Browse filter offers: its options, labels, order and slider steps,
 * and the mapping between the sliders and the filter values. The web filter
 * panel and the app's filter sheet both read them from here, so the two show
 * the same filters. The filter values themselves are matched in
 * ../formatters/listingFilters.js.
 */

// Price range shared by every price slider. The right end ($4000+) means no
// upper limit, so a max of PRICE_MAX or more is stored as "".
export const PRICE_MIN = 400;
export const PRICE_MAX = 4000;
export const PRICE_STEP = 50;

// Bars of the price histogram, each one an equal slice of the price range.
export const PRICE_BAR_COUNT = 20;
const BUCKET = (PRICE_MAX - PRICE_MIN) / PRICE_BAR_COUNT;

// Rents per price bucket. Prices outside the slider's range fall into the
// first and last bars, so the last bar is the "$4000+" bucket.
export function priceBuckets(rents) {
  const counts = new Array(PRICE_BAR_COUNT).fill(0);
  rents.forEach((rent) => {
    const i = Math.floor((rent - PRICE_MIN) / BUCKET);
    counts[Math.min(PRICE_BAR_COUNT - 1, Math.max(0, i))] += 1;
  });
  return counts;
}

export const formatPrice = (v) => (v >= PRICE_MAX ? "$4000+" : `$${v.toLocaleString()}`);

// Slider range for the minRent / maxRent filter strings, and back: "" at either
// end means no limit.
export const rentRange = (minRent, maxRent) => ({
  low: minRent ? Math.max(PRICE_MIN, Number(minRent)) : PRICE_MIN,
  high: maxRent ? Math.min(PRICE_MAX, Number(maxRent)) : PRICE_MAX,
});
export const rentFilters = ({ low, high }) => ({
  minRent: low <= PRICE_MIN ? "" : String(low),
  maxRent: high >= PRICE_MAX ? "" : String(high),
});

// Steps of the bedroom and bathroom sliders. Both ends mean no limit.
export const BED_STEPS = [
  { label: "0",  value: "0" },
  { label: "1",  value: "1" },
  { label: "2",  value: "2" },
  { label: "3",  value: "3" },
  { label: "4",  value: "4" },
  { label: "5+", value: "5" },
];

export const BATH_STEPS = [
  { label: "1",   value: "1"   },
  { label: "1.5", value: "1.5" },
  { label: "2",   value: "2"   },
  { label: "2.5", value: "2.5" },
  { label: "3",   value: "3"   },
  { label: "4+",  value: "4"   },
];

// The walking distance sliders show one stop fewer than the filter has: their
// last stop is the open end ("" = any distance), so the "45" and "20" minute
// values are not offered (they still filter as before, and show at the last
// stop).
export const CAMPUS_STEPS = [
  { label: "10 min", value: "10" },
  { label: "15 min", value: "15" },
  { label: "20 min", value: "20" },
  { label: "30 min", value: "30" },
  { label: "45 min+", value: "" },
];
export const SHUTTLE_STEPS = [
  { label: "2 min", value: "2" },
  { label: "5 min", value: "5" },
  { label: "10 min", value: "10" },
  { label: "20 min+", value: "" },
];

// Index of a filter value in steps ({ label, value }). "" (the open end), or a
// value the steps do not offer, gives fallback.
export const stepIndex = (steps, value, fallback) => {
  const i = value ? steps.findIndex((s) => s.value === value) : -1;
  return i < 0 ? fallback : i;
};

// Filter strings for a range of step indexes: "" at either end means no limit.
export const stepLimits = (steps, { low, high }) => [
  low === 0 ? "" : steps[low].value,
  high === steps.length - 1 ? "" : steps[high].value,
];

// Lease durations always offered. The renter can add others with "Other".
export const FILTER_DURATIONS = ["6-month", "10-month", "12-month"];
export const MAX_DURATION_MONTHS = 36;
// "9-month" to "9-Month Lease". The two older values (from filters saved before
// durations were month counts) keep their names, and the ranges Find Your Place
// hands over read as ranges.
export const durationLabel = (value) =>
  TERM_RANGES[value]?.label ||
  ({ semester: "Semester Lease", summer: "Summer Lease" })[value] ||
  `${parseInt(value, 10)}-Month Lease`;
export const durationMonths = (value) => TERM_RANGES[value]?.order ?? (parseInt(value, 10) || 0);
// The duration a number of months typed into "Other" adds ("9" to "9-month"),
// or null when it is not a whole number from 1 to MAX_DURATION_MONTHS.
export const durationFromMonths = (text) => {
  const months = Number(text);
  if (!Number.isInteger(months) || months < 1 || months > MAX_DURATION_MONTHS) return null;
  return `${months}-month`;
};

export const FILTER_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// February offers the 29th: the filter is for a month of any year.
export const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const FILTER_HOME_TYPES = [
  { label: "Apartment", value: "apartment" },
  { label: "House", value: "house" },
  { label: "Studio", value: "studio" },
  { label: "Townhouse", value: "townhouse" },
  { label: "Single Room", value: "single_room" },
  { label: "Condo", value: "condo" },
];
// The labels say what the listing data knows: it records laundry, parking and
// storage, not whether they are in-unit, private or extra. The values are the
// filter's older names, kept so saved filters still mean the same thing
// (listingFilters.js maps them to the data's names).
export const FILTER_AMENITIES = [
  { label: "Dishwasher", value: "dishwasher" },
  { label: "Laundry", value: "in_unit_laundry" },
  { label: "Air Conditioning", value: "ac_heating" },
  { label: "Mailroom", value: "mailroom" },
  { label: "Pets Allowed", value: "pets_allowed" },
  { label: "Storage", value: "extra_storage" },
  { label: "Parking", value: "private_parking" },
  { label: "Pool", value: "pool" },
  { label: "Study Rooms", value: "study_room" },
  { label: "Gym / Fitness", value: "gym" },
];
// Every value is one the listing data records (the feed's utilitiesRowToArray).
// The design's Hot Water and Yard Care are not recorded, so they matched
// nothing; Heat and Cable take their places.
export const FILTER_UTILITIES = [
  { label: "Water", value: "water" },
  { label: "Electric", value: "electric" },
  { label: "Gas", value: "gas" },
  { label: "Internet", value: "internet" },
  { label: "Trash", value: "trash" },
  { label: "Heat", value: "heat" },
  { label: "Sewer", value: "sewer" },
  { label: "Cable", value: "cable" },
];
export const FILTER_FURNISHED = [
  { label: "Any", value: "" },
  { label: "Furnished", value: "furnished" },
  { label: "Unfurnished", value: "unfurnished" },
];
