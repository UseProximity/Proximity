import { join } from "path";
import { readFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import supabase from "@/lib/supabase";
import { LISTING_SELECT } from "@/lib/listings/listingSelect";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// Maps the student's #1 stated priority to the listing data dimension that
// PROVES it's satisfied. The headline pick must score near the top of the pool
// on this dimension — we give the student what they SAID they care about, not
// what's "objectively best". Priorities with no data column (social ones) map to
// null: we can't verify them, so the budget rule alone decides the headline.
const PRIORITY_TO_DIM = {
  "Close to campus": "proximity",
  "Good value": "value",
  "Great reviews": "reviews",
  "Amenities": "amenities",
  "Quiet/study": "amenities",
  "Social/parties": null,
  "Close to other WashU students": null,
};

// Human phrasing for a spinoff's standout "plus" (the secondary strength that
// makes #2/#3 variations on the headline rather than unrelated listings).
const PLUS_PHRASE = {
  value: "a better price for what you get",
  amenities: "more amenities",
  reviews: "stronger reviews",
  proximity: "a shorter walk",
};

// Approximate centroids (lat/lng) for the neighborhood options in the `area`
// question. Listings only carry coordinates, not a neighborhood label, so we
// treat a listing as being "in" a neighborhood when it falls within
// NEIGHBORHOOD_RADIUS_KM of the centroid; closeness decays linearly to 0 at the
// edge. Coarse, but enough to let a stated neighborhood actually steer the pick.
const NEIGHBORHOOD_CENTROIDS = {
  "The Loop": { lat: 38.6555, lng: -90.3030 },
  "Central West End": { lat: 38.6440, lng: -90.2630 },
  "Clayton": { lat: 38.6426, lng: -90.3237 },
  "DeMun": { lat: 38.6330, lng: -90.3095 },
  "DeBaliviere": { lat: 38.6500, lng: -90.2930 },
};
const NEIGHBORHOOD_RADIUS_KM = 1.3;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 0..1 closeness of a listing to the NEAREST requested neighborhood centroid
// (1 = on the centroid, 0 = at/beyond the radius edge). Returns null when no
// neighborhood is requested or the listing has no coordinates, so the dimension
// is simply skipped. A score > 0 means the listing sits inside the neighborhood.
export function neighborhoodScore(listing, areas) {
  const wanted = (areas ?? []).filter((a) => NEIGHBORHOOD_CENTROIDS[a]);
  if (!wanted.length) return null;
  const lat = Number(listing?.latitude), lng = Number(listing?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = Infinity;
  for (const a of wanted) {
    const c = NEIGHBORHOOD_CENTROIDS[a];
    best = Math.min(best, haversineKm(lat, lng, c.lat, c.lng));
  }
  return Math.max(0, 1 - best / NEIGHBORHOOD_RADIUS_KM);
}

const SKILL_PATH = join(process.cwd(), "src", "lib", "matchmaking", "listing-filter.skill.md");
let _skillMd;
try {
  _skillMd = readFileSync(SKILL_PATH, "utf8");
} catch (err) {
  console.error(`[listingFilter] Failed to load skill markdown from ${SKILL_PATH}:`, err);
  throw new Error(`Listing filter skill not found at ${SKILL_PATH}`);
}

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.PROXY_CHAT_KEY });
  return _client;
}

const RankedItemSchema = z.object({
  listing_id: z.string(),
  score: z.number(),
  intention: z.string(),
  reason: z.string(),
});

const FilterResponseSchema = z.object({
  ranked: z.array(RankedItemSchema),
});

// Flatten the units model into a lease-like list: one entry per active priced
// unit lease, carrying the unit's physical dimensions (bedrooms/bathrooms/area)
// onto each lease so the rest of the ranking logic stays unit-agnostic.
function activeLeasesOf(listing) {
  return (listing.listing_units ?? []).flatMap((u) =>
    (u.unit_leases ?? [])
      .filter((l) => l.is_active && l.rent > 0)
      .map((l) => ({
        rent: Number(l.rent),
        bedrooms: u.bedrooms,
        bathrooms: u.bathrooms,
        area: u.area,
        sublease: l.sublease,
        available_from: l.available_from,
        lease_term_months: l.lease_term_months,
      }))
  );
}

// Cheapest per-person option for a listing (null if no priced lease).
// NOTE: rent on a lease is stored PER PERSON already — do not divide by beds.
function minPerPerson(listing) {
  const leases = activeLeasesOf(listing);
  if (leases.length === 0) return null;
  return Math.min(...leases.map((l) => l.rent));
}

// Parse the group_size preference into a whole number. The chip value can be a
// string like "6+", which Number() turns into NaN — silently collapsing a big
// group to a solo renter and dropping the bedroom requirement entirely. Strip
// the trailing "+" and floor at 1.
function parseGroupSize(raw) {
  const n = parseInt(String(raw ?? "").replace(/\+/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Total bedrooms a listing can house when a group splits across its units in the
// SAME building (each unit with at least one active priced lease counts once).
// Lets a 6-person group match a building of three 2-bed units even when no single
// unit fits everyone — i.e. "living together" without one giant place.
function buildingCapacity(listing) {
  return (listing.listing_units ?? []).reduce((sum, u) => {
    const hasActive = (u.unit_leases ?? []).some((l) => l.is_active && l.rent > 0);
    return hasActive ? sum + (Number(u.bedrooms) || 0) : sum;
  }, 0);
}

// Whether a listing can house the whole group — either a single unit with enough
// bedrooms, or enough total bedrooms across the building's units (split across
// units in the same place). Solo searches (groupSize<=1) always fit.
function listingFitsGroup(listing, groupSize) {
  if (groupSize <= 1) return true;
  const maxBeds = Math.max(0, ...activeLeasesOf(listing).map((l) => Number(l.bedrooms) || 0));
  return maxBeds >= groupSize || buildingCapacity(listing) >= groupSize;
}

function avgReview(listing) {
  const ratings = (listing.listing_reviews ?? [])
    .filter((r) => !r.deleted_at && Number.isFinite(r.rating))
    .map((r) => r.rating);
  if (ratings.length === 0) return null;
  return Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10;
}

// listing_amenities is keyed 1:1 by listing_id, so Supabase returns it as a
// single OBJECT (not an array) — same as the rest of the app's amenitiesRowToArray
// helpers. The old code read `[0]` here and silently got nothing for EVERY
// listing, so the entire amenities dimension was invisible to the ranker.
const AMENITY_KEYS = [
  "air_conditioning", "dishwasher", "gym", "laundry", "mailroom", "microwave",
  "oven", "parking", "pets_allowed", "pool", "refrigerator", "rooftop",
  "storage", "stove", "study_room",
];
function topAmenitiesOf(listing) {
  const a = listing.listing_amenities;
  const row = Array.isArray(a) ? a[0] : a;
  if (!row) return [];
  return AMENITY_KEYS.filter((k) => row[k] === true).map((k) => k.replace(/_/g, " "));
}

// Walk-time destinations come from the `locations` table; each listing carries a
// row per destination. We split them into DISTINCT, non-conflated metrics so a
// med student is matched on the medical campus and a grocery-minded student on
// Schnucks — instead of collapsing every destination into one "campus" number
// (which also wrongly counted the med campus and discarded grocery entirely).
function walkTimesByCategory(listing) {
  const out = { campus: [], med: [], grocery: [], shuttle: [] };
  for (const w of listing.listing_walk_times ?? []) {
    const name = w.locations?.name ?? "";
    if (!Number.isFinite(w.minutes)) continue;
    if (name === "shuttle_nearest") out.shuttle.push(w.minutes);
    else if (/grocery|schnucks/i.test(name)) out.grocery.push(w.minutes);
    else if (/^med\s*campus/i.test(name)) out.med.push(w.minutes);
    else out.campus.push(w.minutes); // Danforth, Olin, Seigle, Sumers, Village House…
  }
  return out;
}
const minOrNull = (arr) => (arr.length ? Math.min(...arr) : null);

// Shortest walk (min) to a MAIN WashU (Danforth) campus point. Excludes the med
// campus, grocery, and the shuttle stop. null when no data — the ranker must NOT guess.
function walkToCampusMin(listing) { return minOrNull(walkTimesByCategory(listing).campus); }
// Walk (min) to the WashU MEDICAL campus — relevant to med students. null when none.
function walkToMedCampusMin(listing) { return minOrNull(walkTimesByCategory(listing).med); }
// Walk (min) to the nearest grocery (Schnucks). null when none.
function walkToGroceryMin(listing) { return minOrNull(walkTimesByCategory(listing).grocery); }
// Walk (min) to the nearest shuttle STOP — NOT a walk to campus. null when none.
function walkToShuttleMin(listing) { return minOrNull(walkTimesByCategory(listing).shuttle); }

// Assemble up to `size` listings that SPAN the spectrum rather than just the
// cheapest: the strongest candidate for each rankable dimension (price, reviews,
// campus/med/grocery proximity, amenities) plus an even stride across the price
// range. This is the key fix for "everyone gets the same cheap listing" — the
// model can only personalize over candidates it actually sees.
function buildDiversePool(items, size) {
  if (items.length <= size) return items;
  const take = (arr, n) => arr.slice(0, n);
  const byPrice = [...items].sort((a, b) => a.perPerson - b.perPerson);
  const byReview = [...items].sort((a, b) => (avgReview(b.listing) ?? -1) - (avgReview(a.listing) ?? -1));
  const byCampus = [...items].sort((a, b) => (walkToCampusMin(a.listing) ?? 1e9) - (walkToCampusMin(b.listing) ?? 1e9));
  const byMed = [...items].sort((a, b) => (walkToMedCampusMin(a.listing) ?? 1e9) - (walkToMedCampusMin(b.listing) ?? 1e9));
  const byGrocery = [...items].sort((a, b) => (walkToGroceryMin(a.listing) ?? 1e9) - (walkToGroceryMin(b.listing) ?? 1e9));
  const byAmen = [...items].sort((a, b) => topAmenitiesOf(b.listing).length - topAmenitiesOf(a.listing).length);

  const picked = new Map();
  const add = (x) => { if (x && !picked.has(x.listing.id)) picked.set(x.listing.id, x); };
  take(byPrice, 6).forEach(add);
  take(byReview, 5).forEach(add);
  take(byCampus, 5).forEach(add);
  take(byMed, 3).forEach(add);
  take(byGrocery, 3).forEach(add);
  take(byAmen, 5).forEach(add);

  // Fill the rest with an even stride across the price distribution for spread.
  const stride = Math.max(1, Math.floor(byPrice.length / size));
  for (let i = 0; i < byPrice.length && picked.size < size; i += stride) add(byPrice[i]);
  for (let i = 0; i < byPrice.length && picked.size < size; i++) add(byPrice[i]); // top up
  return [...picked.values()].slice(0, size);
}

// Display name for a listing: its title, or — when the title is blank in the DB
// — the street line of its address (e.g. "6042 Kingsbury Ave"), so a headline
// pick never renders as an empty card.
function displayTitle(listing) {
  const t = (listing.title ?? "").trim();
  if (t) return t;
  const street = (listing.address ?? "").split(",")[0].trim();
  return street || "Untitled listing";
}

function extractCardData(listing) {
  const hero = (listing.listing_images ?? []).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  )[0];
  return {
    title: displayTitle(listing),
    address: listing.address,
    hero_image_url: hero?.url ?? null,
    min_rent: minPerPerson(listing),
    top_amenities: topAmenitiesOf(listing).slice(0, 3),
  };
}

// Slim, per-person-normalized projection sent to the ranking model. Forces it
// to reason on the right (per-person) number and to see home_type explicitly.
function slimCandidate(listing) {
  const leases = activeLeasesOf(listing);
  return {
    listing_id: listing.id,
    title: displayTitle(listing),
    address: listing.address,
    home_type: listing.home_types?.label ?? null,
    per_person_rent: Math.round(minPerPerson(listing)),
    bedrooms_max: Math.max(0, ...leases.map((l) => Number(l.bedrooms) || 0)),
    // Each lease carries its own array of allowed term lengths; flatten across
    // the listing's active leases into a unique, ascending list of months.
    lease_term_months: [
      ...new Set(leases.flatMap((l) => l.lease_term_months ?? []).map(Number).filter(Number.isFinite)),
    ].sort((a, b) => a - b),
    furnished: listing.furnished ?? null,
    avg_review: avgReview(listing),
    amenities: topAmenitiesOf(listing),
    // null = no distance data on file — the ranker must not claim proximity.
    walk_to_campus_min: walkToCampusMin(listing),
    // Walk to the WashU MEDICAL campus (for med students) — a separate place
    // from the main campus; null when unknown.
    walk_to_med_campus_min: walkToMedCampusMin(listing),
    // Walk to the nearest grocery (Schnucks); null when unknown.
    walk_to_grocery_min: walkToGroceryMin(listing),
    // Walk to nearest shuttle stop (then a shuttle ride to campus) — distinct
    // from walking to campus; the ranker must not conflate the two.
    walk_to_shuttle_min: walkToShuttleMin(listing),
  };
}

// Deterministic weighted "fit" score per candidate, in [0,1]. This is the anchor
// that makes recommendations actually track the student's stated priorities: each
// dimension is normalized across the pool, then combined using `weights`, so
// different weight vectors yield different winners — instead of the LLM defaulting
// to one strong all-rounder for everyone. Dimensions with no data for a listing
// are skipped (never penalized or fabricated).
function computeFitScores(pool, weights, preferences) {
  const w = weights ?? {};
  const reviewNorm = (l) => {
    const r = avgReview(l);
    return r == null ? null : (r - 1) / 4; // 1..5 -> 0..1
  };
  // Proximity is judged against the student's targeted place(s) — so a med
  // student scores on med-campus distance, a grocery-minded one on Schnucks.
  const targets = preferences?.proximity_targets?.length ? preferences.proximity_targets : ["campus"];
  const proxMin = (l) => {
    const vals = [];
    for (const t of targets) {
      const m = t === "med_campus" ? walkToMedCampusMin(l) : t === "grocery" ? walkToGroceryMin(l) : walkToCampusMin(l);
      if (m != null) vals.push(m);
    }
    return vals.length ? Math.min(...vals) : null;
  };
  const proxVals = pool.map(proxMin).filter((x) => x != null);
  const minW = proxVals.length ? Math.min(...proxVals) : 0;
  const maxW = proxVals.length ? Math.max(...proxVals) : 0;
  const proximityNorm = (l) => {
    const m = proxMin(l);
    if (m == null) return null;
    return maxW > minW ? 1 - (m - minW) / (maxW - minW) : 1; // closer = higher
  };
  const maxA = Math.max(0, ...pool.map((l) => topAmenitiesOf(l).length));
  const amenNorm = (l) => (maxA > 0 ? topAmenitiesOf(l).length / maxA : null);

  // Neighborhood closeness to the student's requested area(s). Null (skipped)
  // when no neighborhood was named, so it never affects students who didn't ask.
  const areas = preferences?.area ?? [];
  const neighborhoodNorm = (l) => neighborhoodScore(l, areas);

  // Quality composite from the signals we actually have for a listing
  // (reviews, amenities, proximity). Used to express VALUE as bang-for-buck.
  const qualityOf = (l) => {
    const parts = [reviewNorm(l), amenNorm(l), proximityNorm(l)].filter((x) => x != null);
    return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  };
  // VALUE = quality delivered per dollar, normalized across the pool — NOT raw
  // cheapness. Budget is a hard gate applied elsewhere, so two listings that
  // both clear the budget are treated IDENTICALLY on price alone; we never nudge
  // a student toward the rock-bottom unit just because it's the floor. A
  // mid-priced listing loaded with amenities / strong reviews can be the better
  // value than a bare cheap one — which is what "good value" actually means.
  const ppvRaw = (l) => {
    const v = minPerPerson(l);
    const q = qualityOf(l);
    return v != null && v > 0 && q != null ? (q + 0.05) / v : null;
  };
  const ppvVals = pool.map(ppvRaw).filter((x) => x != null);
  const minV = ppvVals.length ? Math.min(...ppvVals) : 0;
  const maxV = ppvVals.length ? Math.max(...ppvVals) : 0;
  const valueNorm = (l) => {
    const x = ppvRaw(l);
    if (x == null) return null;
    return maxV > minV ? (x - minV) / (maxV - minV) : 1; // more quality per $ = higher
  };

  // NOTE: `budget` is deliberately NOT a fit dimension. Setting a budget is a
  // gate (already applied as a hard filter), not a taste for "cheapest" — folding
  // it in here made the cheapest listing win for everyone. Only the explicit
  // "Good value" priority (-> `value`) rewards price, and only as bang-for-buck.
  const dimNorm = {
    value: valueNorm,
    reviews: reviewNorm,
    amenities: amenNorm,
    location: proximityNorm, walkability: proximityNorm,
    neighborhood: neighborhoodNorm,
  };

  const scores = {};
  // Per-listing normalized score for each data dimension (null = no data). The
  // top-pick logic uses these to verify a listing genuinely satisfies the
  // student's #1 priority before it becomes the headline.
  const dims = {};
  for (const l of pool) {
    dims[l.id] = {
      value: valueNorm(l),
      reviews: reviewNorm(l),
      amenities: amenNorm(l),
      proximity: proximityNorm(l),
      neighborhood: neighborhoodNorm(l),
    };
    let num = 0, den = 0, fbSum = 0, fbN = 0;
    for (const [dim, fn] of Object.entries(dimNorm)) {
      const norm = fn(l);
      if (norm == null) continue;
      const wt = w[dim] ?? 0;
      if (wt > 0) { num += wt * norm; den += wt; }
      // The fallback pool EXCLUDES `value` so a student who never asked about
      // price isn't silently sorted toward the cheapest unit when their chosen
      // dimensions happen to lack data. Budget stays a pure gate.
      if (dim !== "value") { fbSum += norm; fbN++; }
    }
    // Weighted score over dimensions the student cares about AND we have data for;
    // otherwise fall back to the average of available non-price signals (neutral
    // all-round), or a neutral 0.5 when we know nothing.
    scores[l.id] = den > 0 ? num / den : fbN > 0 ? fbSum / fbN : 0.5;
  }
  return { scores, dims };
}

// Deterministic pre-LLM pipeline: turn the raw listing rows into the scored,
// diverse candidate pool plus per-dimension norms and fit scores. Shared by
// rankListings (production) and the saturation simulation so both score the
// candidates identically.
export function buildRankContext(allListings, preferences, weights, limit = 10) {
  const budgetMax = preferences.budget_max ?? Infinity;
  const groupSize = parseGroupSize(preferences.group_size);
  // Listings the user explicitly rejected in a refine turn — never resurface them.
  const excluded = new Set(preferences._excluded ?? []);

  // All listings with a priced active lease, carrying per-person cost, the size
  // of its biggest single unit, and the building's total bedroom capacity.
  const withLeases = (allListings ?? [])
    .filter((listing) => !excluded.has(listing.id))
    .map((listing) => {
      const pp = minPerPerson(listing);
      if (pp == null) return null;
      const maxBeds = Math.max(0, ...activeLeasesOf(listing).map((l) => Number(l.bedrooms) || 0));
      const capacity = Math.max(maxBeds, buildingCapacity(listing));
      return { listing, perPerson: pp, maxBeds, capacity };
    })
    .filter(Boolean);

  // A listing fits the group when a single unit has enough bedrooms OR the whole
  // building does (group splits across units in the same place).
  const fitsGroup = ({ maxBeds, capacity }) => maxBeds >= groupSize || capacity >= groupSize;
  const inBudget = ({ perPerson }) => budgetMax === Infinity || perPerson <= budgetMax;

  // Hard filters only: per-person budget cap + enough room for the group.
  const eligible = withLeases.filter((x) => inBudget(x) && fitsGroup(x));

  // Be honest when we can't actually house the group at their budget, instead of
  // silently relaxing the bedroom filter and showing places that don't fit. The
  // note tracks what selection ACTUALLY does: picks are guaranteed to fit only
  // when there are at least `limit` fitting in-budget options (the `base` switch
  // below); otherwise we fall back and mix in places that won't hold everyone.
  let groupNote = null;
  if (groupSize >= 2) {
    const fitAny = withLeases.filter(fitsGroup);
    const fitInBudget = fitAny.filter(inBudget);
    if (fitAny.length === 0) {
      groupNote = `Heads up — I don't have any listings that can house all ${groupSize} of you together right now, so these are the closest options. You'd likely be splitting across separate places.`;
    } else if (fitInBudget.length === 0) {
      groupNote =
        budgetMax === Infinity
          ? `Heads up — places big enough for ${groupSize} are limited, so a couple of these may be tight on space.`
          : `Heads up — nothing that fits all ${groupSize} of you came in under $${Math.round(budgetMax)}/mo per person, so I've shown the closest fits; the ones large enough run a little over budget.`;
    } else if (fitInBudget.length < limit) {
      groupNote = `Heads up — only a place or two fits all ${groupSize} of you within budget, so I've mixed in nearby options that would mean splitting across separate units.`;
    } else if (fitInBudget.every((x) => x.maxBeds < groupSize)) {
      groupNote = `To fit all ${groupSize} of you, you'd take a few units in the same building rather than one big place.`;
    }
  }

  // Build a DIVERSE pool spanning every dimension — NOT the 30 cheapest. The old
  // cheapest-first slice meant the model only ever saw a cluster of cheap units
  // and handed the same one to everybody. Fall back to the full priced set when
  // the eligible set is too thin (budget still enforced at the end).
  const base = eligible.length >= limit ? eligible : withLeases;
  const pool = buildDiversePool(base, 30).map((x) => x.listing);
  if (pool.length === 0) return { pool: [], dims: {}, fitById: {}, perPersonById: {}, budgetMax, groupNote };

  // Deterministic weighted fit, then sort the pool by it.
  const { scores: fitById, dims } = computeFitScores(pool, weights, preferences);
  pool.sort((a, b) => (fitById[b.id] ?? 0) - (fitById[a.id] ?? 0));
  const perPersonById = Object.fromEntries(pool.map((l) => [l.id, minPerPerson(l)]));
  return { pool, dims, fitById, perPersonById, budgetMax, groupNote };
}

// Pick the deterministic TOP 3. Product rule (deliberately NOT "what's
// objectively best for them"):
//   #1    satisfies their #1 stated priority AND sits right at their budget (the
//         most expensive in-budget satisfier). `saturation` only breaks ties
//         WITHIN the at-budget band, so demand spreads across comparable
//         listings without ever overriding the priority or busting the budget.
//   #2/#3 SPINOFFS: also satisfy the #1 priority, each leading a different plus.
// `saturation` maps listing_id -> a demand count (DB contacts + prior matches);
// HIGHER = more oversubscribed.
export function selectTopThree({ pool, dims, fitById, perPersonById, budgetMax, preferences, saturation = {} }) {
  const withinBudget = (id) => budgetMax === Infinity || (perPersonById[id] ?? Infinity) <= budgetMax;
  const sat = (id) => saturation[id] ?? 0;
  const dimv = (id, k) => dims[id]?.[k];

  const topPriority = Array.isArray(preferences.priorities) ? preferences.priorities[0] : null;
  const priDim = topPriority ? (PRIORITY_TO_DIM[topPriority] ?? null) : null;

  const inBudget = pool.filter((l) => withinBudget(l.id));
  const choiceBase = inBudget.length ? inBudget : [...pool];

  // Neighborhood is a near-hard constraint: if the student named neighborhood(s),
  // the headline (and the spinoffs, where possible) must sit inside one — UNLESS
  // nothing in-budget is there, in which case we fall back rather than return
  // nothing. dims[].neighborhood > 0 means the listing is within the area radius.
  const wantsHood = Array.isArray(preferences.area) && preferences.area.some((a) => a && a !== "No preference");
  const inHood = (l) => (dims[l.id]?.neighborhood ?? 0) > 0;
  const hoodBase = wantsHood ? choiceBase.filter(inHood) : choiceBase;
  const effBase = hoodBase.length ? hoodBase : choiceBase;

  // Group fit gates BEFORE priority: a place that can't hold everyone is useless
  // to the group, so when the search is for 2+ people and ANY in-scope listing
  // fits them, the headline (and spinoffs) are chosen only from fitting listings.
  // Listings that don't fit are still usable as "if you're open to splitting up"
  // options, so we keep them for backfill — flagged, never as the headline.
  const groupSize = parseGroupSize(preferences.group_size);
  const needsGroup = groupSize >= 2;
  const fitsGroup = (l) => listingFitsGroup(l, groupSize);
  const fittingEff = needsGroup ? effBase.filter(fitsGroup) : effBase;
  const groupBase = needsGroup && fittingEff.length ? fittingEff : effBase;
  // A pick is a "split up" option when the group needs space the listing can't
  // give on its own — surfaced only because nothing better fits.
  const isSplit = (l) => needsGroup && !fitsGroup(l);

  // Listings that genuinely satisfy the #1 priority: top of the pool on its data
  // dimension (within 80% of the best). Social priorities have no data column, so
  // they can't be verified — every in-budget listing qualifies and budget decides.
  let satisfiers = groupBase;
  if (priDim) {
    const withData = groupBase
      .filter((l) => dimv(l.id, priDim) != null)
      .sort((a, b) => dimv(b.id, priDim) - dimv(a.id, priDim));
    if (withData.length) {
      const best = dimv(withData[0].id, priDim);
      satisfiers = withData.filter((l) => dimv(l.id, priDim) >= best * 0.8);
    }
  }

  // Headline: build the "at budget" band (within 8% of the priciest in-budget
  // satisfier, or the top fit band when no budget is set), then let saturation
  // choose the freshest listing inside that band.
  let headline;
  if (satisfiers.length) {
    const hasBudget = preferences.budget_max != null;
    const rank = (l) => (hasBudget ? (perPersonById[l.id] ?? 0) : (fitById[l.id] ?? 0));
    const sorted = [...satisfiers].sort((a, b) => rank(b) - rank(a));
    const top = rank(sorted[0]);
    const band = hasBudget
      ? sorted.filter((l) => rank(l) >= top * 0.92)
      : sorted.filter((l) => rank(l) >= top - 0.03);
    headline = band.sort((a, b) => sat(a.id) - sat(b.id) || rank(b) - rank(a))[0];
  }
  headline = headline ?? [...groupBase].sort((a, b) => (fitById[b.id] ?? 0) - (fitById[a.id] ?? 0))[0];

  // Spinoffs: each leads a different secondary plus; saturation breaks ties among
  // near-equal candidates on that plus.
  const SECONDARY = ["value", "amenities", "reviews", "proximity"].filter((k) => k !== priDim);
  const spinPool = satisfiers.filter((l) => l.id !== headline?.id);
  const spinoffs = [];
  const usedSpin = new Set();
  for (const key of SECONDARY) {
    if (spinoffs.length >= 2) break;
    const ranked = spinPool
      .filter((l) => !usedSpin.has(l.id) && dimv(l.id, key) != null)
      .sort((a, b) => dimv(b.id, key) - dimv(a.id, key));
    if (!ranked.length) continue;
    const top = dimv(ranked[0].id, key);
    const tieBand = ranked.filter((l) => dimv(l.id, key) >= top - 0.05);
    const best = tieBand.sort((a, b) => sat(a.id) - sat(b.id) || dimv(b.id, key) - dimv(a.id, key))[0];
    if (best) { spinoffs.push({ listing: best, key }); usedSpin.add(best.id); }
  }
  // Backfill if data was too thin to find two distinct standout plusses. Prefer
  // listings that actually fit the group first (isSplit false sorts ahead), so
  // split-up options only appear once nothing better is left.
  if (spinoffs.length < 2) {
    for (const l of [...spinPool, ...effBase, ...choiceBase].sort(
      (a, b) => (isSplit(a) - isSplit(b)) || sat(a.id) - sat(b.id) || (fitById[b.id] ?? 0) - (fitById[a.id] ?? 0)
    )) {
      if (spinoffs.length >= 2) break;
      if (l.id === headline?.id || usedSpin.has(l.id)) continue;
      spinoffs.push({ listing: l, key: null });
      usedSpin.add(l.id);
    }
  }

  const priorityWord = topPriority ? topPriority.toLowerCase() : "your top priority";
  const top3 = [];
  if (headline) {
    const splitHead = isSplit(headline);
    top3.push({
      listing_id: headline.id,
      score: Math.round((fitById[headline.id] ?? 0) * 100) / 100,
      intention: "Best overall match",
      group_fit: !splitHead,
      reason: splitHead
        ? `Built around what you care about most — ${priorityWord}. Best if you're open to splitting across a few nearby places, since nothing I have fits all ${groupSize} of you together.`
        : preferences.budget_max != null
        ? `Right at your budget and built around what you care about most — ${priorityWord}.`
        : `Built around what you care about most — ${priorityWord}.`,
      card_data: extractCardData(headline),
    });
  }
  for (const { listing, key } of spinoffs) {
    const split = isSplit(listing);
    top3.push({
      listing_id: listing.id,
      score: Math.round((fitById[listing.id] ?? 0) * 100) / 100,
      intention:
        key === "value" ? "Best value"
        : key === "amenities" ? "Most amenities"
        : key === "reviews" ? "Best reviews"
        : key === "proximity" ? "Closest to campus"
        : "Another strong fit",
      group_fit: !split,
      reason: split
        ? key
          ? `If you're open to splitting up, this one brings ${PLUS_PHRASE[key]}.`
          : `Another option if you're open to splitting across separate places.`
        : key
        ? `Same focus on ${priorityWord}, with ${PLUS_PHRASE[key]}.`
        : `Another place that leans into ${priorityWord}.`,
      card_data: extractCardData(listing),
    });
  }
  return top3;
}

// Live saturation signal from the DB: how oversubscribed each listing already
// is. Contacts weigh more than prior recommendations (a contact is real demand;
// merely being shown is softer). Returns listing_id -> weighted count. Best-effort
// — any failure yields {} so saturation never blocks a ranking.
export async function fetchSaturation() {
  const counts = {};
  try {
    const { data: itype } = await supabase
      .from("interaction_types").select("id").eq("name", "contacted").maybeSingle();
    if (itype?.id) {
      const { data: rows } = await supabase
        .from("user_listing_interactions").select("listing_id").eq("interaction_type_id", itype.id);
      for (const r of rows ?? []) counts[r.listing_id] = (counts[r.listing_id] ?? 0) + 2;
    }
  } catch { /* best-effort */ }
  try {
    const { data: sessions } = await supabase
      .from("matchmaking_chat_sessions").select("recommendations").not("recommendations", "is", null);
    for (const s of sessions ?? []) {
      const recs = Array.isArray(s.recommendations) ? s.recommendations : s.recommendations?.ranked;
      for (const r of recs ?? []) {
        const id = r?.listing_id ?? r?.id;
        if (id) counts[id] = (counts[id] ?? 0) + 1;
      }
    }
  } catch { /* best-effort */ }
  return counts;
}

export async function rankListings({
  preferences,
  weights,
  requestedIntentions,
  limit = 10,
  // Optional in-memory exposure added on top of the live DB saturation — used by
  // the saturation simulation to accrue matches across a run without DB writes.
  exposure = {},
}) {
  const { data: allListings, error } = await supabase
    .from("listings")
    .select(`${LISTING_SELECT}, listing_walk_times(minutes, locations(name))`)
    .is("deleted_at", null)
    .eq("unavailable", false)
    .limit(80);

  if (error) throw new Error(`[listingFilter] Supabase fetch failed: ${error.message}`);

  const ctx = buildRankContext(allListings, preferences, weights, limit);
  const { pool, dims, fitById, perPersonById, budgetMax, groupNote } = ctx;
  if (pool.length === 0) {
    return { ranked: [], usage: null, groupNote };
  }

  // Live saturation (DB contacts + prior matches) plus any injected exposure.
  const dbSat = await fetchSaturation();
  const saturation = { ...dbSat };
  for (const [id, n] of Object.entries(exposure)) saturation[id] = (saturation[id] ?? 0) + n;

  const hasAmenities = (id) => topAmenitiesOf(candidatesById[id]).length > 0;
  const hasReview = (id) => avgReview(candidatesById[id]) != null;
  const hasWalk = (id) => walkToCampusMin(candidatesById[id]) != null;

  // Drop intentions the data can't truthfully support (e.g. "Most amenities"
  // when no candidate has any amenities), then backfill to `limit` distinct.
  const supported = (label) => {
    if (label === "Most amenities") return pool.some((l) => topAmenitiesOf(l).length > 0);
    if (label === "Best reviews") return pool.some((l) => avgReview(l) != null);
    if (label === "Closest to campus") return pool.some((l) => walkToCampusMin(l) != null);
    return true;
  };
  const BACKFILL = ["Best overall match", "Best value", "Most flexible lease", "Best social fit", "Closest to campus", "Best reviews", "Most amenities"];
  let effectiveIntentions = [...new Set((requestedIntentions ?? []).filter(supported))];
  if (!effectiveIntentions.includes("Best overall match")) effectiveIntentions.unshift("Best overall match");
  for (const b of BACKFILL) {
    if (effectiveIntentions.length >= limit) break;
    if (!effectiveIntentions.includes(b) && supported(b)) effectiveIntentions.push(b);
  }
  effectiveIntentions = effectiveIntentions.slice(0, limit);

  const userContent = JSON.stringify({
    preferences,
    weights,
    candidates: pool.map((l) => ({ ...slimCandidate(l), fit_score: Math.round((fitById[l.id] ?? 0) * 100) / 100 })),
    requestedIntentions: effectiveIntentions,
    limit,
    instruction:
      "Each candidate has fit_score (0–1): a precomputed weighted match to THIS student's stated priorities; candidates are pre-sorted by it. 'Best overall match' should be the highest-fit_score candidate (break ties with your judgment). Use per_person_rent (already per person). Treat houses and apartments equally. Only use an intention label the chosen listing truly earns. Respond with JSON only — no prose, no markdown fences.",
  });

  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: _skillMd,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  const raw = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();

  const parsed = FilterResponseSchema.safeParse(JSON.parse(jsonText));
  if (!parsed.success) {
    throw new Error(`[listingFilter] Invalid response schema: ${parsed.error.message}`);
  }

  const candidatesById = Object.fromEntries(pool.map((l) => [l.id, l]));
  const withinBudget = (id) => budgetMax === Infinity || (perPersonById[id] ?? Infinity) <= budgetMax;

  // Keep only picks that reference a real candidate (drop any hallucinated ids).
  const enriched = parsed.data.ranked
    .filter((r) => candidatesById[r.listing_id])
    .map((r) => ({ ...r, card_data: extractCardData(candidatesById[r.listing_id]) }));

  // Guarantee up to `limit` results: pad from the cheapest remaining candidates,
  // preferring ones within budget, assigning any unused intention.
  if (enriched.length < limit) {
    const usedIds = new Set(enriched.map((r) => r.listing_id));
    const usedIntentions = new Set(enriched.map((r) => r.intention));
    const spareIntentions = effectiveIntentions.filter((i) => !usedIntentions.has(i));
    const padOrder = [...pool].sort((a, b) => {
      const aOk = withinBudget(a.id) ? 0 : 1;
      const bOk = withinBudget(b.id) ? 0 : 1;
      return aOk - bOk || (perPersonById[a.id] ?? 0) - (perPersonById[b.id] ?? 0);
    });
    for (const listing of padOrder) {
      if (enriched.length >= limit) break;
      if (usedIds.has(listing.id)) continue;
      enriched.push({
        listing_id: listing.id,
        score: 0,
        intention: spareIntentions.shift() ?? "Best overall match",
        reason: "Another option that matches what you told me.",
        card_data: extractCardData(listing),
      });
      usedIds.add(listing.id);
    }
  }

  // Swap the listing in slot `i` with another slot that satisfies `ok`, keeping
  // each slot's intention label intact.
  const swapToSatisfy = (i, ok) => {
    if (i < 0 || ok(enriched[i].listing_id)) return;
    const donor = enriched.findIndex((r, j) => j !== i && ok(r.listing_id));
    if (donor < 0) return;
    const a = enriched[i];
    const b = enriched[donor];
    [a.listing_id, b.listing_id] = [b.listing_id, a.listing_id];
    [a.score, b.score] = [b.score, a.score];
    [a.reason, b.reason] = [b.reason, a.reason];
    [a.card_data, b.card_data] = [b.card_data, a.card_data];
  };

  // Data-backed intentions must land on a listing that actually has the data —
  // never label a 0-amenity listing "Most amenities", etc. (Applied to the
  // model's list before we split out the deterministic top 3 below.)
  swapToSatisfy(enriched.findIndex((r) => r.intention === "Most amenities"), hasAmenities);
  swapToSatisfy(enriched.findIndex((r) => r.intention === "Best reviews"), hasReview);
  swapToSatisfy(enriched.findIndex((r) => r.intention === "Closest to campus"), hasWalk);

  // Deterministic TOP 3 (priority-met, at-budget, saturation-spread). The lower
  // slots stay model-driven.
  const top3 = selectTopThree({ pool, dims, fitById, perPersonById, budgetMax, preferences, saturation });

  // Deterministic top 3 first, then the model's remaining distinct picks (so the
  // lower slots keep their variety), deduped.
  const topIds = new Set(top3.map((r) => r.listing_id));
  const tail = enriched.filter((r) => !topIds.has(r.listing_id));
  const finalRanked = [...top3, ...tail].slice(0, limit);

  return { ranked: finalRanked, usage: response.usage, groupNote };
}
