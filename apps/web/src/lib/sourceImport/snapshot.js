/*
 * The one shape every reader produces and the one shape the writer consumes.
 *
 * A snapshot is what a landlord's website says about one property, normalised
 * onto Proximity's own model: a property, its units (floor plans in a big
 * building, apartments in a small one), and on each unit the offers a student
 * could take. Readers for different platforms (SightMap, RentCafe, Entrata, a
 * model-read page) all end here, so the writer that lays a snapshot over a
 * listing never has to know where the numbers came from.
 *
 *   {
 *     sourceUrl, indexUrl, platform, confidence: "high" | "low",
 *     property: { name, address, description, homeType, furnished,
 *                 amenities[], customAmenities[], utilities[],
 *                 contactName, contactEmail, contactPhone,
 *                 photos: [{ url, alt }], concessions: [text] },
 *     units: [{ key, name, bedrooms, bathrooms, area, floorPlanImageUrl,
 *               available, photos: [url],
 *               offers: [{ rent, rentIsPerPerson, leaseTermMonths, availableFrom,
 *                          apartments }] }],
 *     notes: [text]
 *   }
 *
 * Offers are the PRD's leases: one per price on a unit, carrying every lease
 * length offered at that price and the earliest date anything at that price is
 * free (null = available now). Apartments at the same price on the same floor
 * plan are one offer, which is why the apartment numbers ride along on it.
 */

export const AMENITY_VALUES = [
  "air_conditioning", "dishwasher", "gym", "laundry", "mailroom",
  "microwave", "oven", "parking", "pets_allowed", "pool",
  "refrigerator", "rooftop", "storage", "stove", "study_room",
];
export const UTILITY_VALUES = [
  "electric", "gas", "heat", "water", "internet",
  "trash", "cable", "sewer", "cooling",
];
export const HOME_TYPES = ["apartment", "house", "condo", "townhouse", "other"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* A positive finite number, or null. "" and "n/a" both become null. */
export function num(value, { max = Infinity, min = 0 } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/* Whole dollars. $1,965.00 and 1965 are the same rent. */
export function money(value) {
  const n = num(value, { max: 100000 });
  return n == null || n <= 0 ? null : Math.round(n);
}

/*
 * A date the site states, as YYYY-MM-DD, or null for "now" and for anything
 * unreadable. Month-day dates take the next occurrence, the way a leasing
 * office means them.
 */
export function isoDate(value, today = new Date()) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || /^(now|immediately|today|available now)$/i.test(s)) return null;
  if (ISO_DATE.test(s)) return s;
  const mdy = s.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    let year = mdy[3] ? Number(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]) : today.getFullYear();
    if (!mdy[3]) {
      const candidate = new Date(Date.UTC(year, month - 1, day));
      if (candidate < new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))) year += 1;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
  const named = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/);
  if (named) {
    const mi = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase());
    if (mi >= 0) {
      const day = Number(named[2]);
      let year = named[3] ? Number(named[3]) : today.getFullYear();
      if (!named[3]) {
        const candidate = new Date(Date.UTC(year, mi, day));
        if (candidate < new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))) year += 1;
      }
      return `${year}-${String(mi + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

/* Lease lengths in months: whole numbers from 1 to 36, deduped and sorted. */
export function termList(values) {
  const out = new Set();
  for (const v of values ?? []) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 36) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/*
 * The key a unit is matched on across reads. The name wins when the site gives
 * one ("Pershing", "6219 S"); otherwise the layout and size, which is what a
 * floor plan without a name is. Letters and digits only, lowercased, so
 * "DOR-3BTD" and "DOR 3BTD" are one plan.
 */
export function unitKey(unit) {
  const name = String(unit?.name ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (name) return `n:${name}`;
  const beds = unit?.bedrooms ?? "x";
  const baths = unit?.bathrooms ?? "x";
  const area = unit?.area ?? "x";
  return `l:${beds}-${baths}-${area}`;
}

/*
 * Fold raw offers into one per price.
 *
 * Input offers come in whatever grain the site used: one per apartment, one
 * per lease length, or one per plan. The PRD's lease is one per price, so
 * everything at $1,819 becomes one offer carrying every lease length seen at
 * that price, the apartments it covers, and the soonest date any of them is
 * free. Per-person and whole-unit prices never merge even when the number
 * matches. An offer with no price ("call for pricing") is kept as one
 * unpriced offer so the unit still exists; it sorts last.
 */
export function consolidateOffers(raw = []) {
  const groups = new Map();
  for (const o of raw) {
    if (!o) continue;
    const rent = money(o.rent);
    const perPerson = !!o.rentIsPerPerson;
    const key = rent == null ? "none" : `${rent}:${perPerson ? "pp" : "whole"}`;
    const terms = termList(o.leaseTermMonths);
    const date = isoDate(o.availableFrom);
    const apartments = (o.apartments ?? []).map((a) => String(a ?? "").trim()).filter(Boolean);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        rent,
        rentIsPerPerson: rent == null ? false : perPerson,
        leaseTermMonths: terms,
        // null means "now", and now beats any date.
        availableFrom: date,
        apartments: [...new Set(apartments)],
        dated: date !== null,
      });
      continue;
    }
    g.leaseTermMonths = termList([...g.leaseTermMonths, ...terms]);
    g.apartments = [...new Set([...g.apartments, ...apartments])];
    if (date === null) g.availableFrom = null;
    else if (g.availableFrom !== null && date < g.availableFrom) g.availableFrom = date;
  }
  return [...groups.values()]
    .map(({ dated, ...o }) => o)
    .sort((a, b) => {
      if (a.rent == null && b.rent == null) return 0;
      if (a.rent == null) return 1;
      if (b.rent == null) return -1;
      return a.rent - b.rent;
    });
}

/*
 * Clean a unit the way the database will take it. Bedrooms are whole numbers
 * (0 = studio), bathrooms can be halves, sizes are square feet. A count a home
 * cannot have is dropped rather than published.
 */
export function cleanUnit(unit) {
  const beds = num(unit.bedrooms, { max: 20 });
  const baths = num(unit.bathrooms, { max: 20 });
  const area = num(unit.area, { max: 20000, min: 50 });
  const name = String(unit.name ?? "").replace(/\s+/g, " ").replace(/,/g, " ").trim().slice(0, 80) || null;
  const cleaned = {
    name,
    bedrooms: beds == null ? null : Math.round(beds),
    bathrooms: baths == null ? null : Math.round(baths * 2) / 2,
    area: area == null ? null : Math.round(area),
    floorPlanImageUrl: typeof unit.floorPlanImageUrl === "string" && /^https?:/.test(unit.floorPlanImageUrl) ? unit.floorPlanImageUrl : null,
    available: unit.available !== false,
    photos: [...new Set((unit.photos ?? []).filter((u) => typeof u === "string" && /^https?:/.test(u)))],
    offers: consolidateOffers(unit.offers ?? []),
  };
  cleaned.key = unit.key ?? unitKey(cleaned);
  return cleaned;
}

/*
 * The finished snapshot. Everything optional defaults to empty so the writer
 * can read any field without guarding, and the unit list is deduped on key:
 * the same floor plan read off two pages is one unit, its offers merged.
 */
export function makeSnapshot({
  sourceUrl,
  indexUrl = null,
  platform = "generic",
  confidence = "low",
  property = {},
  units = [],
  notes = [],
}) {
  const byKey = new Map();
  for (const raw of units) {
    const u = cleanUnit(raw);
    const existing = byKey.get(u.key);
    if (!existing) {
      byKey.set(u.key, u);
      continue;
    }
    existing.bedrooms ??= u.bedrooms;
    existing.bathrooms ??= u.bathrooms;
    existing.area ??= u.area;
    existing.floorPlanImageUrl ??= u.floorPlanImageUrl;
    existing.name ??= u.name;
    existing.available = existing.available && u.available;
    existing.photos = [...new Set([...existing.photos, ...u.photos])];
    existing.offers = consolidateOffers([...existing.offers, ...u.offers]);
  }
  const p = property ?? {};
  return {
    sourceUrl,
    indexUrl,
    platform,
    confidence,
    readAt: new Date().toISOString(),
    property: {
      name: p.name?.trim() || null,
      address: p.address?.trim() || null,
      description: p.description?.trim() || null,
      homeType: HOME_TYPES.includes(p.homeType) ? p.homeType : null,
      furnished: typeof p.furnished === "boolean" ? p.furnished : null,
      amenities: (p.amenities ?? []).filter((a) => AMENITY_VALUES.includes(a)),
      customAmenities: [...new Set((p.customAmenities ?? []).map((a) => String(a).trim()).filter(Boolean))].slice(0, 20),
      utilities: (p.utilities ?? []).filter((u) => UTILITY_VALUES.includes(u)),
      contactName: p.contactName?.trim() || null,
      contactEmail: p.contactEmail?.trim()?.toLowerCase() || null,
      contactPhone: p.contactPhone?.trim() || null,
      photos: dedupePhotos(p.photos ?? []).slice(0, 24),
      concessions: [...new Set((p.concessions ?? []).map((c) => String(c).trim()).filter(Boolean))].slice(0, 6),
    },
    units: [...byKey.values()],
    notes: [...new Set(notes.filter(Boolean))].slice(0, 12),
  };
}

function dedupePhotos(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const url = typeof p === "string" ? p : p?.url;
    if (!url || !/^https?:/.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, alt: typeof p === "string" ? "" : p?.alt ?? "" });
  }
  return out;
}

/* How many offers and apartments a snapshot carries, for logs and the digest. */
export function summarize(snapshot) {
  const units = snapshot?.units ?? [];
  return {
    units: units.length,
    offers: units.reduce((n, u) => n + u.offers.length, 0),
    priced: units.reduce((n, u) => n + u.offers.filter((o) => o.rent != null).length, 0),
    apartments: units.reduce((n, u) => n + u.offers.reduce((m, o) => m + o.apartments.length, 0), 0),
    photos: (snapshot?.property?.photos ?? []).length + units.reduce((n, u) => n + u.photos.length, 0),
    floorPlans: units.filter((u) => u.floorPlanImageUrl).length,
  };
}

/*
 * A stable fingerprint of what matters for sync: units, prices, terms, dates.
 * Photos and prose are left out so a copy edit on the site does not read as a
 * change to the listing.
 */
export function fingerprint(snapshot) {
  const units = (snapshot?.units ?? [])
    .map((u) => ({
      k: u.key,
      b: u.bedrooms,
      ba: u.bathrooms,
      a: u.area,
      av: u.available,
      o: u.offers.map((o) => [o.rent, o.rentIsPerPerson ? 1 : 0, o.leaseTermMonths, o.availableFrom, [...o.apartments].sort()]),
    }))
    .sort((a, b) => (a.k < b.k ? -1 : 1));
  return JSON.stringify(units);
}
