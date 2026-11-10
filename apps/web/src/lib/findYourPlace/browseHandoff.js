/*
 * "Browse All N Matches": the browse page opened with the student's answers
 * pre-set in its own filter bar (Wyatt, 2026-11-10).
 *
 * Only filters browse already has are used, so the result is deliberately a
 * bit looser than the matcher: the student sees them in the bar and can change
 * any of them. Answers browse has no filter for (a neighborhood, a bike or
 * drive limit, anything typed freely) are not applied; `notApplied` names
 * them. Nothing shows it today (the line under browse's filters was removed,
 * Wyatt 2026-11-10), but it is kept so a caller can tell what was left out.
 */
import { needsPetFriendly } from "@/lib/matchmaking/listingConstraints";
import { NO_PREFERENCE, moveInCutoff } from "./options";

// Parsed amenity key (a listing_amenities column) -> browse's amenity filter value.
const BROWSE_AMENITY = {
  laundry: "in_unit_laundry",
  parking: "private_parking",
  air_conditioning: "ac_heating",
  storage: "extra_storage",
  dishwasher: "dishwasher",
  gym: "gym",
  pool: "pool",
  study_room: "study_room",
  mailroom: "mailroom",
};

// Find Your Place lease answer -> browse's lease-length buckets.
const BROWSE_LEASE = {
  semester: ["summer", "semester"],
  academic: ["10-month"],
  full: ["12-month"],
};

const NEIGHBORHOOD_NAMES = {
  "The Loop": "Delmar Loop",
  "Central West End": "Central West End",
  Clayton: "Clayton",
  DeMun: "DeMun",
  DeBaliviere: "DeBaliviere",
};

const dollars = (n) => "$" + Math.round(n).toLocaleString("en-US");

export function buildBrowseHandoff({ answers, parsed, preferences }) {
  const filters = {};
  const notApplied = [];

  // Bedrooms: an exact headcount up to 4 is one unit of that size. A 5+ group
  // may be housed across several units, which no bedroom filter can express.
  const group = parseInt(answers.group, 10);
  const oneUnit = Number.isFinite(group) && group >= 1 && group <= 4;
  if (oneUnit) {
    filters.bedrooms = String(group);
    filters.maxBedrooms = String(group);
  } else if (Number.isFinite(group)) {
    notApplied.push("room for " + group);
  }

  /*
   * Rent. Browse's max-rent filter reads a lease's rent as posted, which is
   * per person on some listings and for the whole unit on others. The cap is
   * therefore the student's per-person max times the headcount: nothing they
   * could afford is hidden, at the cost of letting through some per-person
   * listings above their max. The looser side is the right side to err on.
   */
  if (typeof answers.budget === "number") {
    if (oneUnit) filters.maxRent = String(answers.budget * group);
    else notApplied.push("up to " + dollars(answers.budget) + " per person");
  }

  const cutoff = answers.moveIn && answers.moveIn !== NO_PREFERENCE ? moveInCutoff(answers.moveIn) : null;
  if (cutoff) filters.moveInDate = cutoff;

  if (BROWSE_LEASE[answers.lease]) filters.leaseAvailability = BROWSE_LEASE[answers.lease];
  else if (/^\d+$/.test(answers.lease ?? "")) notApplied.push(answers.lease + " month lease");

  if (parsed.furnished === "yes") filters.furnished = "furnished";
  else if (parsed.furnished === "no") filters.furnished = "unfurnished";

  const amenities = parsed.amenities.map((k) => BROWSE_AMENITY[k]).filter(Boolean);
  // Browse's own "Pets Allowed" filter (the listing's flag).
  if (needsPetFriendly(preferences)) amenities.push("pets_allowed");
  if (amenities.length) filters.amenities = [...new Set(amenities)];

  if (parsed.areas.length) notApplied.push(parsed.areas.map((a) => NEIGHBORHOOD_NAMES[a] ?? a).join(" or "));

  return { filters, notApplied };
}
