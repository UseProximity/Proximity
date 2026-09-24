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

/*
 * One offer on a unit: a rent, when it opens up, and the lease lengths it is
 * written for. Becomes one unit_leases row. A blank availableFrom means
 * available now.
 */
export const emptyLease = () => ({
  rent: "",
  rentIsPerPerson: false,
  availableFrom: "",
  leaseTermMonths: [],
});

/*
 * A unit is one FLOOR PLAN: the layout (beds, baths, size, diagram) and,
 * underneath it, every distinct offer on it. Apartments that share a floor plan
 * and a rent are the same offer, so they are one lease, not one row each.
 */
export const emptyUnit = () => ({
  bedrooms: "",
  bathrooms: "",
  area: "",
  // False for a waitlist-only plan: kept with the listing, not offered.
  available: true,
  title: "",
  floorPlanImageUrl: "",
  // Photos of this unit (not the building), already uploaded, filed against
  // the unit once the listing exists.
  photos: [],
  leases: [emptyLease()],
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/*
 * Collapse offers on one floor plan into one lease per rent.
 *
 * Three apartments on the same plan at $1,819 are one option to a student, so
 * they become one lease carrying every lease length offered at that rent. Its
 * date is the soonest of theirs, and "now" if any of them is free today,
 * because a lease holds one date and the soonest is the true answer to "when
 * could I move in at this price". A different rent is a different option and
 * stays its own lease. Cheapest first; a blank rent (contact for pricing) last.
 */
export function mergeLeasesByRent(offers = []) {
  const groups = new Map();
  for (const o of offers) {
    if (!o) continue;
    const rent = o.rent === "" || o.rent == null ? "" : Math.round(Number(o.rent));
    const key = rent === "" || !Number.isFinite(rent) ? "" : rent;
    const terms = (o.leaseTermMonths ?? []).map(Number).filter((m) => Number.isFinite(m) && m > 0);
    const date = ISO_DATE.test(o.availableFrom ?? "") ? o.availableFrom : "";
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        rent: key,
        rentIsPerPerson: !!o.rentIsPerPerson,
        availableFrom: date,
        leaseTermMonths: [...new Set(terms)].sort((a, b) => a - b),
      });
      continue;
    }
    g.leaseTermMonths = [...new Set([...g.leaseTermMonths, ...terms])].sort((a, b) => a - b);
    // Blank is "now", which beats any date.
    if (g.availableFrom && (!date || date < g.availableFrom)) g.availableFrom = date;
  }
  const leases = [...groups.values()].sort((a, b) =>
    a.rent === "" ? 1 : b.rent === "" ? -1 : a.rent - b.rent
  );
  return leases.length ? leases : [emptyLease()];
}

/*
 * Bring a unit saved by an older version of this form into the current shape.
 *
 * Drafts autosave to the browser, so a landlord part-way through an import
 * still holds units in the old floor-plan-card shape: a list of apartment
 * numbers with a rent and date for each, the card's own lease lengths, and
 * "extra prices" for other lengths. Each apartment and each extra price becomes
 * an offer, and the offers merge by rent exactly as a fresh import does.
 */
export function normalizeWizardUnit(u) {
  if (!u || typeof u !== "object") return emptyUnit();
  const base = {
    bedrooms: u.bedrooms ?? "",
    bathrooms: u.bathrooms ?? "",
    area: u.area ?? "",
    available: u.available !== false,
    title: u.title ?? "",
    floorPlanImageUrl: u.floorPlanImageUrl ?? "",
    photos: Array.isArray(u.photos) ? u.photos : [],
  };
  if (Array.isArray(u.leases)) {
    return {
      ...base,
      leases: u.leases.length ? u.leases.map((l) => ({ ...emptyLease(), ...l })) : [emptyLease()],
    };
  }
  const terms = Array.isArray(u.leaseTermMonths) ? u.leaseTermMonths : [];
  const planDate = ISO_DATE.test(u.availableFrom ?? "") ? u.availableFrom : "";
  const names = parseUnitNumbers(u.designator, u.unitNumbers).filter(Boolean);
  const apartmentOffers = names.map((n) => ({
    rent: u.unitRents?.[n] ?? u.rent ?? "",
    availableFrom: u.unitAvailability?.[n] || planDate,
    leaseTermMonths: terms,
  }));
  const offers = apartmentOffers.length
    ? apartmentOffers
    : [{ rent: u.rent ?? "", availableFrom: planDate, leaseTermMonths: terms }];
  const soonest = offers.some((o) => !o.availableFrom)
    ? ""
    : offers.map((o) => o.availableFrom).sort()[0] ?? "";
  for (const extra of u.extraLeases ?? []) {
    if (extra?.rent === "" || extra?.rent == null) continue;
    offers.push({ rent: extra.rent, availableFrom: soonest, leaseTermMonths: extra.leaseTermMonths ?? [] });
  }
  return { ...base, leases: mergeLeasesByRent(offers) };
}

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
    out.push(normalizeUnitToken(token));
  }
  return Array.from(new Set(out));
}

/*
 * "2w" is a code and reads better as "2W". "Madrid" is a name and reading it
 * back as "MADRID" looks like shouting — buildings that name their apartments
 * after cities (Clocktower does) had every one of them upper-cased. Uppercase
 * the codes, leave real words as the landlord typed them.
 */
function normalizeUnitToken(token) {
  const isCode = /\d/.test(token) || token.length <= 2;
  return isCode ? token.toUpperCase() : token;
}

/*
 * Lay a landlord's website over the listing they already have on Proximity.
 *
 * Used when an import finds the address is already theirs. What is live is the
 * starting point; the website's values are applied on top of it, and every row
 * says where it stands so nothing changes unseen:
 *
 *   status "live"     on Proximity and on the website; `live` holds what is on
 *                     Proximity now, so the step can say "was $1,100"
 *   status "new"      on the website only: added on publish
 *   status "missing"  on Proximity only: kept unless the landlord marks it
 *                     unavailable (`retire`)
 *
 * Units match by bedrooms and bathrooms, the floor plan name breaking a tie.
 * Leases match by rent within a unit; a lease whose rent changed still has to
 * be recognised as the same lease, so what is left over pairs up by a shared
 * lease length, and a unit with a single lease on each side is taken to be
 * one lease with a new price ("was $650"). Only the landlord's own leases are
 * editable; other landlords' offerings on the same unit are only counted.
 * Where the website is silent (no floor plan, no size), the live value stays.
 */
export function mergeWithLive(websiteUnits = [], liveUnits = []) {
  const snapLease = (l) => ({
    id: l.id,
    rent: l.rent == null ? "" : String(Number(l.rent)),
    rentIsPerPerson: !!l.rentIsPerPerson,
    availableFrom: l.availableFrom ?? "",
    leaseTermMonths: l.leaseTermMonths ?? [],
    unavailable: !!l.unavailable,
  });
  const snapUnit = (u) => ({
    id: u.id,
    bedrooms: u.bedrooms ?? "",
    bathrooms: u.bathrooms ?? "",
    area: u.area ?? "",
    title: u.title ?? "",
    floorPlanImageUrl: u.floorPlanImageUrl ?? "",
  });
  const fromLive = (ll, status) => ({
    rent: ll.rent,
    rentIsPerPerson: ll.rentIsPerPerson,
    availableFrom: ll.availableFrom,
    leaseTermMonths: ll.leaseTermMonths,
    live: ll,
    status,
    retire: false,
  });
  const name = (t) => String(t ?? "").trim().toLowerCase();
  const pool = liveUnits.map((u) => ({ u, used: false }));
  const out = [];

  for (const w of websiteUnits) {
    const same = pool.filter(
      (p) =>
        !p.used &&
        Number(p.u.bedrooms) === Number(w.bedrooms) &&
        Number(p.u.bathrooms) === Number(w.bathrooms)
    );
    const hit = same.find((p) => name(p.u.title) && name(p.u.title) === name(w.title)) ?? same[0];
    if (!hit) {
      out.push({ ...w, status: "new", leases: (w.leases ?? []).map((l) => ({ ...l, status: "new" })) });
      continue;
    }
    hit.used = true;
    const live = snapUnit(hit.u);
    const mine = (hit.u.leases ?? []).filter((l) => l.isMine).map(snapLease);
    const matched = new Set();
    const site = (w.leases ?? [])
      // An empty placeholder lease from the site says nothing; the live ones stand.
      .filter((wl) => wl.rent !== "" || (wl.leaseTermMonths ?? []).length || !mine.length);
    const pairOf = new Map();
    const pair = (wl, ll) => {
      pairOf.set(wl, ll);
      matched.add(ll.id);
    };
    const free = () => mine.filter((ll) => !matched.has(ll.id));
    // 1. Same rent.
    for (const wl of site) {
      const m = free().find((ll) => wl.rent !== "" && Number(ll.rent) === Number(wl.rent));
      if (m) pair(wl, m);
    }
    // 2. Same lease length, price changed.
    for (const wl of site.filter((x) => !pairOf.has(x))) {
      const m = free().find((ll) =>
        (ll.leaseTermMonths ?? []).some((t) => (wl.leaseTermMonths ?? []).map(Number).includes(Number(t)))
      );
      if (m) pair(wl, m);
    }
    // 3. A unit with one lease on each side: the same lease, repriced. Only
    //    then; with several, a guess would pair unrelated offers.
    if (site.length === 1 && mine.length === 1 && !pairOf.size) pair(site[0], mine[0]);
    // The website wins where it says something. Where it is silent (many sites
    // publish no lease lengths, some no price), what is live stays.
    const leases = site.map((wl) => {
      const ll = pairOf.get(wl);
      if (!ll) return { ...wl, status: "new" };
      return {
        ...wl,
        rent: wl.rent === "" ? ll.rent : wl.rent,
        leaseTermMonths: (wl.leaseTermMonths ?? []).length ? wl.leaseTermMonths : ll.leaseTermMonths,
        live: ll,
        status: "live",
        retire: false,
      };
    });
    out.push({
      ...w,
      title: w.title || live.title,
      area: w.area !== "" && w.area != null ? w.area : live.area,
      floorPlanImageUrl: w.floorPlanImageUrl || live.floorPlanImageUrl,
      live,
      status: "live",
      othersLeases: (hit.u.leases ?? []).filter((l) => !l.isMine && l.live).length,
      leases: [...leases, ...mine.filter((ll) => !matched.has(ll.id)).map((ll) => fromLive(ll, "missing"))],
    });
  }

  for (const p of pool.filter((p) => !p.used)) {
    const live = snapUnit(p.u);
    out.push({
      ...emptyUnit(),
      bedrooms: live.bedrooms,
      bathrooms: live.bathrooms,
      area: live.area,
      title: live.title,
      floorPlanImageUrl: live.floorPlanImageUrl,
      live,
      status: "missing",
      retire: false,
      othersLeases: (p.u.leases ?? []).filter((l) => !l.isMine && l.live).length,
      leases: (p.u.leases ?? []).filter((l) => l.isMine).map((l) => fromLive(snapLease(l), "missing")),
    });
  }
  return out;
}
