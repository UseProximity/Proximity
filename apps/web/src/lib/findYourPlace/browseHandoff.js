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
import { NO_PREFERENCE, moveInCutoff, nextOccurrence, slowestMode, isOpenEnded } from "./options";

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

// Find Your Place lease answer -> browse's duration chips ("<n>-month").
const BROWSE_LEASE = {
  semester: ["6-month"],
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

// Browse's walking-time sliders (FiltersPanel). A limit sets the smallest stop
// that is not stricter than it: looser, never tighter, than the answer.
const CAMPUS_WALK_STOPS = [10, 15, 20, 30];
const SHUTTLE_WALK_STOPS = [2, 5, 10];
// Raised whenever what the hand-off sets changes, so a saved set of matches
// carrying an older hand-off is searched again rather than reused.
export const HANDOFF_VERSION = 2;
const stopFor = (stops, minutes) => stops.find((s) => s >= minutes) ?? null;

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
  // With no headcount, the per-person max itself is the cap (Wyatt,
  // 2026-11-14: the price is always set when they gave one).
  if (typeof answers.budget === "number") {
    filters.maxRent = String(answers.budget * (Number.isFinite(group) && group >= 1 ? group : 1));
  }

  /*
   * Commute. Browse filters on the walk to campus and the walk to a shuttle
   * stop, so those two answers are set there. A bike or drive limit has no
   * browse filter. The open-ended last chip sets nothing.
   */
  const mode = slowestMode(answers.modes ?? []);
  if (mode && typeof answers.commuteMax === "number" && !isOpenEnded(mode, answers.commuteMax)) {
    const stop =
      mode.id === "walk" ? stopFor(CAMPUS_WALK_STOPS, answers.commuteMax)
      : mode.id === "shuttle" ? stopFor(SHUTTLE_WALK_STOPS, answers.commuteMax)
      : null;
    if (stop != null) filters[mode.id === "walk" ? "distance" : "distanceToShuttle"] = String(stop);
    else notApplied.push(`${mode.id} within ${answers.commuteMax} min`);
  }

  /*
   * Move-in. Browse's control is a month: "open by the end of the next such
   * month", the same rule the matcher uses. A month further out than its next
   * occurrence (picked under "Other") has no such control, so it falls back to
   * the older move-in-by date, which still filters but has no chip.
   */
  if (answers.moveIn && answers.moveIn !== NO_PREFERENCE) {
    const month = Number(answers.moveIn.slice(5, 7));
    if (nextOccurrence(month) === answers.moveIn) filters.moveInMonth = String(month);
    else filters.moveInDate = moveInCutoff(answers.moveIn);
  }

  if (BROWSE_LEASE[answers.lease]) filters.leaseAvailability = BROWSE_LEASE[answers.lease];
  else if (/^\d+$/.test(answers.lease ?? "")) filters.leaseAvailability = [answers.lease + "-month"];

  if (parsed.furnished === "yes") filters.furnished = "furnished";
  else if (parsed.furnished === "no") filters.furnished = "unfurnished";

  const amenities = parsed.amenities.map((k) => BROWSE_AMENITY[k]).filter(Boolean);
  // Browse's own "Pets Allowed" filter (the listing's flag).
  if (needsPetFriendly(preferences)) amenities.push("pets_allowed");
  if (amenities.length) filters.amenities = [...new Set(amenities)];

  if (parsed.areas.length) notApplied.push(parsed.areas.map((a) => NEIGHBORHOOD_NAMES[a] ?? a).join(" or "));

  return { filters, notApplied, version: HANDOFF_VERSION };
}
