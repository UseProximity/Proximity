/*
 * "Browse All N Matches": what the browse page needs to show a student the
 * rest of their matches (Wyatt, 2026-11-10). Two parts, used together:
 *
 *   filters  Answers browse has a filter for, pre-set in its own filter bar
 *            where the student can see and change them: bedrooms, move-in
 *            date, lease length, furnishing, amenities.
 *   ids      The listings that pass everything browse has NO filter for:
 *            rent per person (browse filters on a lease's rent, which may be
 *            for the whole unit), the group and sublease rules, the
 *            neighborhood they named, and pets (judged from the description
 *            as well as the flag, which the matcher trusts more than browse's
 *            flag-only filter). Browse shows only these.
 *
 * `summary` names what the ids are holding to, for the line browse shows under
 * its filters.
 */
import { neighborhoodScore } from "@/lib/matchmaking/listingFilter";
import { needsPetFriendly, descriptionAllowsPets } from "@/lib/matchmaking/listingConstraints";
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

const amenityRow = (listing) => {
  const a = listing.listing_amenities;
  return (Array.isArray(a) ? a[0] : a) ?? null;
};

const dollars = (n) => "$" + Math.round(n).toLocaleString("en-US");

export function buildBrowseHandoff({ answers, parsed, preferences, strict }) {
  const filters = {};
  const summary = [];

  // Bedrooms: an exact headcount up to 4 is one unit of that size. A 5+ group
  // may be housed across several units, which no bedroom filter can express.
  const group = parseInt(answers.group, 10);
  if (Number.isFinite(group) && group >= 1 && group <= 4) {
    filters.bedrooms = String(group);
    filters.maxBedrooms = String(group);
  } else if (Number.isFinite(group)) {
    summary.push("room for " + group);
  }

  if (typeof answers.budget === "number") summary.push("up to " + dollars(answers.budget) + " per person");

  const cutoff = answers.moveIn && answers.moveIn !== NO_PREFERENCE ? moveInCutoff(answers.moveIn) : null;
  if (cutoff) filters.moveInDate = cutoff;

  if (BROWSE_LEASE[answers.lease]) filters.leaseAvailability = BROWSE_LEASE[answers.lease];
  else if (/^\d+$/.test(answers.lease ?? "")) summary.push(answers.lease + " month lease");

  if (parsed.furnished === "yes") filters.furnished = "furnished";
  else if (parsed.furnished === "no") filters.furnished = "unfurnished";

  const amenities = [...new Set(parsed.amenities.map((k) => BROWSE_AMENITY[k]).filter(Boolean))];
  if (amenities.length) filters.amenities = amenities;

  let fits = strict;
  if (parsed.areas.length) {
    fits = fits.filter((x) => neighborhoodScore(x.listing, parsed.areas) > 0);
    summary.push(parsed.areas.map((a) => NEIGHBORHOOD_NAMES[a] ?? a).join(" or "));
  }
  if (needsPetFriendly(preferences)) {
    fits = fits.filter((x) => amenityRow(x.listing)?.pets_allowed === true || descriptionAllowsPets(x.listing));
    summary.push("pets allowed");
  }

  return { ids: fits.map((x) => String(x.listing.id)), filters, summary };
}
