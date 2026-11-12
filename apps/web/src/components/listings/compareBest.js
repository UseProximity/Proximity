/*
 * Who wins in each objective row of the compare table (ComparePanel marks the
 * winner's value). The rules live here, so to change them or drop
 * the feature, change this file and its use in ComparePanel.
 *
 * A row has a winner only when both values are usable and not equal. Nothing is
 * filtered out as "failed": a walk time is compared as it is shown.
 *
 * The price is the exception: it is compared as the whole unit's monthly rent
 * (each lease's unitRent, from the shared rent-basis helper), not as the table
 * shows it. The table shows the landlord's figure, per person or for the unit, so
 * the pill can sit on the side whose shown number is higher.
 */
import { getCampusWalkMinutes } from "@/utils/listingFormatters";

// The winning value followed by a small "Better" pill, in the red family of the
// "shared / differences" summary. The pill is inline, so it flows with the value
// and wraps with it as one piece instead of squeezing the value.
export function Winner({ children }) {
  return (
    <span>
      {children}
      <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 align-middle text-xs font-medium text-red-700">
        Better
      </span>
    </span>
  );
}

// The range of whole-unit rents across the unit's leases, or null when none is
// priced. unitRent is worked out on the server (shapeLeases, with leaseRentBasis
// in lib/listings/rentBasis.js): a stated per-person rent times the bedrooms, a
// stated whole-unit rent as is, and an unstated one guessed by the helper's
// split test. So every lease is in the same terms, whatever its flag.
function rentOf(unit) {
  const rents = (unit?.leases ?? [])
    .map((l) => Number(l.unitRent))
    .filter((r) => Number.isFinite(r) && r > 0);
  return rents.length ? { min: Math.min(...rents), max: Math.max(...rents) } : null;
}

// Each row: [label, the value a side compares, which direction wins]. A side with
// no usable value is null. The price is a range, so it has its own rule below.
const ROWS = [
  ["Area:", (l, u) => (Number(u?.area) > 0 ? Number(u.area) : null), "higher"],
  ["Distance to campus:", (l) => getCampusWalkMinutes(l), "lower"],
  ["Distance to shuttle:", (l) => l.shuttleWalkMinutes, "lower"],
  [
    "Rating:",
    // Compared as shown (one decimal), so two listings that read "4.3" are a tie.
    (l) => ((Number(l.numReviews) || 0) > 0 && Number(l.rating) > 0 ? Number(Number(l.rating).toFixed(1)) : null),
    "higher",
  ],
];

// Two sets of row labels, one per side, holding the rows that side wins. Empty
// unless both listings are there.
export function bestRows(listings, units) {
  const best = [new Set(), new Set()];
  if (!listings[0] || !listings[1]) return best;

  const win = (label, a, b, dir) => {
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return;
    best[(dir === "higher" ? a > b : a < b) ? 0 : 1].add(label);
  };
  for (const [label, value, dir] of ROWS) {
    win(label, value(listings[0], units[0]), value(listings[1], units[1]), dir);
  }

  // Price: one whole-unit rent range wholly below the other.
  const [a, b] = [rentOf(units[0]), rentOf(units[1])];
  if (a && b) {
    if (a.max < b.min) best[0].add("Price:");
    else if (b.max < a.min) best[1].add("Price:");
  }
  return best;
}
