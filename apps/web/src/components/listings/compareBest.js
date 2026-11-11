/*
 * Who wins in each objective row of the compare table (ComparePanel marks the
 * winner's value). The rules live here, so to change them or drop
 * the feature, change this file and its use in ComparePanel.
 *
 * A row has a winner only when both values are usable and not equal. Nothing is
 * filtered out as "failed": a walk time is compared as it is shown.
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

// The one rent range a column shows, as the table shows it: leases split by the
// landlord's flag, with an unset flag read as the whole unit. null when there is
// no price or when the column shows both bases, which cannot be compared.
function rentOf(unit) {
  const rents = (perPerson) =>
    (unit?.leases ?? [])
      .filter((l) => !!l.rentIsPerPerson === perPerson)
      .map((l) => Number(l.rent))
      .filter((r) => Number.isFinite(r) && r > 0);
  const [whole, person] = [rents(false), rents(true)];
  if (!!whole.length === !!person.length) return null;
  const list = whole.length ? whole : person;
  return { perPerson: !!person.length, min: Math.min(...list), max: Math.max(...list) };
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

  // Price: the same basis, and one range wholly below the other.
  const [a, b] = [rentOf(units[0]), rentOf(units[1])];
  if (a && b && a.perPerson === b.perPerson) {
    if (a.max < b.min) best[0].add("Price:");
    else if (b.max < a.min) best[1].add("Price:");
  }
  return best;
}
