// Unit and lease presentation helpers for the listing detail page. Ported from
// the web's LeaseOptions.js, ListingModalInfo.js (unit tabs), utils/unitOrder.js
// and utils/availability.js. Pure JS, so mobile renders the same units, labels,
// ordering and lease options as web. Keep in sync with those files.

// ─── Units ────────────────────────────────────────────────────────────────────

// The landlord's own order first (listing_units.sort_order), then beds, then
// baths for any unit that has never been placed.
const orderOf = (u) => u?.sortOrder ?? u?.sort_order ?? null;

export function compareUnits(a, b) {
  const oa = orderOf(a);
  const ob = orderOf(b);
  if (oa != null || ob != null) {
    if (oa == null) return 1;
    if (ob == null) return -1;
    if (oa !== ob) return oa - ob;
  }
  const beds = (a?.bedrooms ?? 0) - (b?.bedrooms ?? 0);
  if (beds !== 0) return beds;
  return (a?.bathrooms ?? 0) - (b?.bathrooms ?? 0);
}

// The units a renter can pick between, in tab order, each with its label.
// Retired units (available === false) are dropped. Units are never
// de-duplicated: two identical-looking units are two apartments. Identical
// labels get a "(1)", "(2)" suffix in the order the units arrived.
export function buildUnitTabs(unitTypes) {
  const units = (unitTypes ?? []).filter((u) => u.available !== false);
  const isStudio = (u) => (u.bedrooms ?? 0) === 0;

  const base = units.map((u) => {
    if (u.name) return { full: u.name, short: u.name };
    if (isStudio(u)) return { full: "Studio", short: "Studio" };
    const beds = u.bedrooms != null ? String(u.bedrooms) : "?";
    const baths = u.bathrooms != null ? String(u.bathrooms) : "?";
    return { full: `${beds} Bed / ${baths} Bath`, short: `${beds} Br / ${baths} Ba` };
  });
  const counts = {};
  for (const { full } of base) counts[full] = (counts[full] || 0) + 1;
  const counters = {};
  const labels = base.map(({ full, short }) => {
    if (counts[full] > 1) {
      counters[full] = (counters[full] || 0) + 1;
      const n = counters[full];
      return { num: n, label: `${full} (${n})`, shortLabel: `${short} (${n})` };
    }
    return { num: 0, label: full, shortLabel: short };
  });
  return units
    .map((unit, i) => ({ unit, ...labels[i] }))
    .sort((a, b) => compareUnits(a.unit, b.unit) || a.num - b.num);
}

// "2 bed · 1 bath · 850 sq ft". Area only when known.
export function unitSpecsLabel(unit) {
  return [
    (unit?.bedrooms ?? 0) === 0 ? "Studio" : `${unit?.bedrooms ?? "?"} bed`,
    `${unit?.bathrooms ?? "?"} bath`,
    ...(unit?.area != null ? [`${Number(unit.area).toLocaleString("en-US")} sq ft`] : []),
  ].join(" · ");
}

// ─── Leases ───────────────────────────────────────────────────────────────────

export const leasePriceLabel = (n) =>
  n == null ? null : `$${Number(n).toLocaleString("en-US")}`;

// Every term the landlord will accept, ascending and de-duplicated.
export function leaseTermList(leaseTermMonths) {
  return [
    ...new Set(
      (leaseTermMonths ?? []).map(Number).filter((m) => Number.isFinite(m) && m > 0)
    ),
  ].sort((a, b) => a - b);
}

// Up to three terms are listed outright ("3, 6, 12 months"), because a range
// would imply terms that are not on offer. Past three it collapses to a range.
export function leaseDurationLabel(leaseTermMonths) {
  const months = leaseTermList(leaseTermMonths);
  if (!months.length) return null;
  if (months.length === 1) return `${months[0]} months`;
  if (months.length <= 3) return `${months.join(", ")} months`;
  return `${months[0]}–${months[months.length - 1]} months`;
}

export const leaseTypeLabel = (lease) => (lease?.sublease ? "Sublease" : "Standard");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A date column is a calendar day, so it is compared as written rather than
// shifted into the viewer's timezone.
function todayDay() {
  return new Date().toISOString().slice(0, 10);
}

// { text, now }. A date on or before today reads "Now"; a missing date is "-"
// (unknown, not "available now").
export function leaseAvailabilityLabel(availableFrom) {
  if (!availableFrom) return { text: "-", now: false };
  const day = String(availableFrom).slice(0, 10);
  if (day <= todayDay()) return { text: "Now", now: true };
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return { text: "-", now: false };
  return { text: `${MONTHS[m - 1]} ${d}, ${y}`, now: false };
}

// Unknowns (no price, no start date, no stated term) sort last: an offering
// that hasn't said is not the cheapest, soonest or shortest.
const lastIfNull = (fn) => (a, b) => {
  const x = fn(a);
  const y = fn(b);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return x < y ? -1 : x > y ? 1 : 0;
};

export const LEASE_SORTS = {
  price: { label: "Price", compare: lastIfNull((l) => l.rent) },
  availability: {
    label: "Availability",
    // A date already past reads as "Now", so it sorts as today.
    compare: lastIfNull((l) => {
      if (!l.availableFrom) return null;
      const day = String(l.availableFrom).slice(0, 10);
      const today = todayDay();
      return day < today ? today : day;
    }),
  },
  duration: {
    label: "Lease length",
    compare: lastIfNull((l) => leaseTermList(l.leaseTermMonths)[0] ?? null),
  },
};

// A stable sort by `compare`, falling back to arrival order (cheapest first).
const stableSort = (items, compare) =>
  items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => compare(a.item, b.item) || a.i - b.i)
    .map(({ item }) => item);

// One group per landlord (the server's landlordKey). Name and photo come from
// the first of their leases that has them.
function groupByLandlord(leases) {
  const groups = new Map();
  for (const lease of leases) {
    const key = lease.landlordKey ?? lease.ownerId ?? lease.id;
    let g = groups.get(key);
    if (!g) {
      g = { key, landlordName: null, landlordImage: null, leases: [] };
      groups.set(key, g);
    }
    g.leases.push(lease);
    if (!g.landlordName && lease.landlordName) g.landlordName = lease.landlordName;
    if (!g.landlordImage && lease.landlordImage) g.landlordImage = lease.landlordImage;
  }
  return [...groups.values()];
}

// Landlord groups for one unit's leases under a sort ("price" | "availability"
// | "duration"): leases are sorted inside each group, then the groups by their
// best option under the same rule.
export function groupLeasesByLandlord(leases, sortBy = "price") {
  const { compare } = LEASE_SORTS[sortBy] ?? LEASE_SORTS.price;
  const sortedWithin = groupByLandlord(leases ?? []).map((g) => ({
    ...g,
    leases: stableSort(g.leases, compare),
  }));
  return stableSort(sortedWithin, (a, b) => compare(a.leases[0], b.leases[0]));
}

// "3 lease options from $900/mo" for a landlord with several leases.
export function landlordLeaseSummary(leases) {
  const priced = leases.filter((l) => l.rent != null);
  const cheapest = priced.length ? priced.reduce((a, b) => (b.rent < a.rent ? b : a)) : null;
  return cheapest
    ? `${leases.length} lease options from ${leasePriceLabel(cheapest.rent)}${
        cheapest.rentIsPerPerson ? "/person" : "/mo"
      }`
    : `${leases.length} lease options`;
}
