/*
 * "Suggested for you": ranks the browse feed against one student's taste
 * profile. Pure functions over the BUILT listing shape (fetchListings()), no
 * DB access, so the signal loading lives in suggestionSignals.js and this file
 * can be reasoned about (and replayed) on plain objects.
 *
 * Three signals, weighted in this order (Wyatt, 2026-10-16):
 *
 *   1. MATCHMAKING   the latest Proxy chat where budget or area was answered.
 *   2. INTERACTIONS  saved and contacted listings, read as exemplars: a listing
 *                    scores by how much it resembles the places they acted on
 *                    (bedrooms first, then price, walk time to campus, type).
 *                    A contact is a stronger signal than a save.
 *   3. FILTERS       the browse filters they last saved (user_filter_summaries).
 *
 * Every signal decays with age on a smooth curve: near full weight for the
 * first couple of weeks, still high at a month, little to nothing by six
 * months (see recencyWeight). A source's weight is its base weight times its
 * recency, and the final score is the weighted mean of the sources present.
 *
 * Cold start: suggestions need at least MIN_DATA_POINTS live data points, in
 * any combination. Each saved or contacted LISTING is one point (saving and
 * contacting the same place is still one), a matchmaking session is one, a
 * saved filter set is one. A signal that has decayed below STALE_WEIGHT no
 * longer counts as a point.
 *
 * Never suggested: unavailable listings, subleases, anything the student has
 * already contacted, a gender-restricted listing they can't take, and a
 * room-share when matchmaking says they are searching as a group. Saved
 * listings CAN be suggested.
 *
 * Unknown rent is neutral (0.5) on every price dimension: neither a match nor a
 * miss. Rent always goes through rentBasis.js.
 *
 * "Similar to" mode (Wyatt, 2026-10-16): the chat's no-reply note links to
 * browse with the listing the student contacted as an ANCHOR. Resemblance to
 * that one listing is ANCHOR_WEIGHT of the score and the student's usual
 * profile the rest, so it mostly breaks ties. The data-point minimum does not
 * apply (the anchor is the signal), a place more than one bedroom away from
 * the anchor is not suggested, the anchor itself never is, and the anchor
 * landlord's other listings rank after everyone else's.
 */

import { minPerPersonRent } from "@/lib/listings/rentBasis";
import { DEFAULT_FILTERS, matchListing } from "@/lib/listings/filterListings";
import { neighborhoodScore } from "@/lib/geo/neighborhoods";
import {
  isListingExcludedForViewer,
  isRoomShareListing,
} from "@/lib/matchmaking/listingConstraints";

export const SOURCE_WEIGHTS = { matchmaking: 0.5, interactions: 0.35, filters: 0.15 };
export const INTERACTION_WEIGHTS = { contacted: 1, saved: 0.7 };
export const MIN_DATA_POINTS = 2;
export const MAX_SUGGESTIONS = 4;
export const ANCHOR_WEIGHT = 0.75;
// A signal this decayed (about 3 months old) no longer counts toward the minimum.
export const STALE_WEIGHT = 0.1;
// Scores this close are a tie, broken toward the less-contacted listing so the
// same few places are not pushed at everyone (same idea as matchmaking).
const TIE_BAND = 0.02;

const DAY_MS = 24 * 60 * 60 * 1000;
// exp(-(days / 65)^2): 2 days ~1.0, 30 days ~0.81, 60 days ~0.43,
// 90 days ~0.15, 180 days ~0.
const DECAY_DAYS = 65;

const NEUTRAL = 0.5;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function recencyWeight(at, now = Date.now()) {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return 0;
  const days = Math.max(0, (now - t) / DAY_MS);
  return Math.exp(-((days / DECAY_DAYS) ** 2));
}

// ---------------------------------------------------------------------------
// Listing features
// ---------------------------------------------------------------------------

export function featuresOf(listing, campusMinutes) {
  const units = (listing.unitTypes ?? []).filter((u) => u.available !== false);
  const beds = [
    ...new Set(units.map((u) => u.bedrooms).filter((b) => Number.isFinite(b))),
  ];
  return {
    perPerson: minPerPersonRent(listing),
    beds,
    walk: campusMinutes(listing),
    homeType: listing.homeType && listing.homeType !== "Other" ? listing.homeType : null,
    furnished:
      !!listing.furnished ||
      units.some((u) => (u.leases ?? []).some((l) => l.furnished === true)),
  };
}

// ---------------------------------------------------------------------------
// Signal 1: matchmaking answers
// ---------------------------------------------------------------------------

// True when the session holds real answers, not just an opened chat.
export function isAnsweredSession(prefs) {
  if (!prefs) return false;
  const budget = Number(prefs.budget_max);
  if (Number.isFinite(budget) && budget > 0) return true;
  return Array.isArray(prefs.area) && prefs.area.length > 0;
}

// "Studio" -> {min:0,max:0}; "3" -> {3,3}; "5+" -> {5,Inf}; "5-7" -> {5,7}.
function groupRangeOf(groupSize) {
  const s = String(groupSize ?? "").trim();
  if (!s) return null;
  if (/studio/i.test(s)) return { min: 0, max: 0 };
  const range = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return { min: n, max: s.endsWith("+") ? Infinity : n };
}

function scoreBudget(f, budgetMax) {
  if (f.perPerson == null) return NEUTRAL;
  if (f.perPerson <= budgetMax) return 1;
  // Soft: fades to 0 at 25% over budget.
  return clamp01(1 - (f.perPerson - budgetMax) / (0.25 * budgetMax));
}

function scoreGroup(f, range) {
  if (!f.beds.length) return NEUTRAL;
  // A solo student fits a studio or a 1-bed outright, anything else loosely.
  if (range.max === 1) return f.beds.some((b) => b <= 1) ? 1 : NEUTRAL;
  if (f.beds.some((b) => b >= range.min && b <= range.max)) return 1;
  const gap = Math.min(
    ...f.beds.map((b) => (b < range.min ? range.min - b : b - range.max))
  );
  return gap <= 1 ? NEUTRAL : 0;
}

function scoreMatchmaking(listing, f, prefs) {
  const dims = [];
  const budget = Number(prefs.budget_max);
  if (Number.isFinite(budget) && budget > 0) dims.push(scoreBudget(f, budget));

  const areas = (prefs.area ?? []).filter((a) => a !== "No preference");
  if (areas.length) dims.push(neighborhoodScore(listing, areas) ?? NEUTRAL);

  const range = groupRangeOf(prefs.group_size);
  if (range) dims.push(scoreGroup(f, range));

  if (prefs.furnished === "Yes") dims.push(f.furnished ? 1 : 0);
  if (prefs.furnished === "No") dims.push(f.furnished ? NEUTRAL : 1);

  const priorities = prefs.priorities ?? [];
  if (priorities.includes("Close to campus")) {
    dims.push(f.walk == null ? NEUTRAL : clamp01(1 - (f.walk - 5) / 25));
  }
  if (priorities.includes("Great reviews")) {
    dims.push(listing.numReviews > 0 ? clamp01((listing.rating ?? 0) / 5) : 0.4);
  }

  return dims.length ? dims.reduce((a, b) => a + b, 0) / dims.length : NEUTRAL;
}

// ---------------------------------------------------------------------------
// Signal 2: saved and contacted listings as exemplars
// ---------------------------------------------------------------------------

/*
 * How much a listing resembles one the student acted on. Bedroom count leads:
 * it is the hardest constraint to compromise on (a group of two cannot take a
 * 1-bed), so a one-bedroom miss costs most of the dimension. Closeness to campus
 * is compared as walk minutes, not map distance (Wyatt, 2026-10-16): two places
 * a street apart can differ in what they offer, while two 10-minute walks from
 * opposite sides of campus answer the same need.
 */
function similarity(a, b) {
  let beds = NEUTRAL;
  if (a.beds.length && b.beds.length) {
    const gap = Math.min(...a.beds.flatMap((x) => b.beds.map((y) => Math.abs(x - y))));
    beds = gap === 0 ? 1 : gap === 1 ? 0.2 : 0;
  }
  const price =
    a.perPerson != null && b.perPerson != null
      ? clamp01(1 - Math.abs(a.perPerson - b.perPerson) / (0.35 * b.perPerson))
      : NEUTRAL;
  const campus =
    a.walk != null && b.walk != null ? clamp01(1 - Math.abs(a.walk - b.walk) / 10) : NEUTRAL;
  const home = a.homeType && b.homeType ? (a.homeType === b.homeType ? 1 : 0) : NEUTRAL;
  return 0.45 * beds + 0.25 * price + 0.2 * campus + 0.1 * home;
}

function scoreInteractions(f, exemplars) {
  let num = 0;
  let den = 0;
  for (const e of exemplars) {
    num += e.weight * similarity(f, e.features);
    den += e.weight;
  }
  return den ? num / den : NEUTRAL;
}

// ---------------------------------------------------------------------------
// Signal 3: saved browse filters
// ---------------------------------------------------------------------------

// Browse filter keys that only make sense together are tested as one criterion.
const FILTER_GROUPS = [
  ["minRent", "maxRent"],
  ["bedrooms", "maxBedrooms"],
  ["bathrooms", "maxBathrooms"],
  ["distance"],
  ["distanceToShuttle"],
  ["moveInDate"],
  ["homeType"],
  ["leaseAvailability"],
  ["amenities"],
  ["furnished"],
  ["utilitiesIncluded"],
  ["subleaseFriendly"],
  ["leaseStructure"],
];
const PRICE_GROUP = FILTER_GROUPS[0];

const isSet = (v) => (Array.isArray(v) ? v.length > 0 : v !== "" && v != null && v !== false);

// Only the keys browse knows about, and only the ones actually set. Per-visit
// toggles (savedOnly) and sublease-only searches are not taste.
export function cleanFilterSummary(raw) {
  const out = {};
  for (const group of FILTER_GROUPS) {
    for (const k of group) {
      const v = raw?.[k];
      if (!isSet(v)) continue;
      if (Array.isArray(DEFAULT_FILTERS[k])) {
        if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === "string").slice(0, 20);
      } else if (typeof DEFAULT_FILTERS[k] === "boolean") {
        out[k] = v === true;
      } else if (typeof v === "string" || typeof v === "number") {
        out[k] = String(v).slice(0, 40);
      }
    }
  }
  return out;
}

/*
 * The fraction of the saved criteria a listing meets, using the exact browse
 * semantics (matchListing) one criterion at a time, so a place that misses one
 * of five filters still scores 0.8 instead of disappearing. A price criterion
 * met only because the rent is unpublished counts as neutral.
 */
function scoreFilters(listing, summary, campusMinutes) {
  const active = FILTER_GROUPS.filter((g) => g.some((k) => isSet(summary[k])));
  if (!active.length) return NEUTRAL;
  let total = 0;
  for (const group of active) {
    const filters = { ...DEFAULT_FILTERS };
    for (const k of group) if (summary[k] !== undefined) filters[k] = summary[k];
    const m = matchListing(listing, { filters, search: "", savedIds: [], campusMinutes });
    if (!m) continue;
    total += group === PRICE_GROUP && m.priceUnknown ? NEUTRAL : 1;
  }
  return total / active.length;
}

// ---------------------------------------------------------------------------
// Profile + ranking
// ---------------------------------------------------------------------------

/**
 * Turn raw signals into a profile.
 *
 * signals: {
 *   sessions:     [{ preferences, updated_at }]          newest first
 *   interactions: [{ listing_id, type: "saved"|"contacted", created_at }]
 *   filterSummary: { filters, updated_at } | null
 *   gender:       users.gender | null
 * }
 */
export function buildTasteProfile(signals, listingsById, campusMinutes, now = Date.now()) {
  const session = (signals.sessions ?? []).find((s) => isAnsweredSession(s.preferences));
  const matchmaking = session
    ? { prefs: session.preferences, weight: recencyWeight(session.updated_at, now) }
    : null;

  // One exemplar per listing, carrying its strongest decayed signal.
  const byListing = new Map();
  const contactedIds = new Set();
  for (const row of signals.interactions ?? []) {
    const id = String(row.listing_id);
    if (row.type === "contacted") contactedIds.add(id);
    const recency = recencyWeight(row.created_at, now);
    const w = (INTERACTION_WEIGHTS[row.type] ?? 0) * recency;
    const prev = byListing.get(id);
    if (!prev || w > prev.weight) byListing.set(id, { id, weight: w, recency });
  }
  const exemplars = [];
  for (const e of byListing.values()) {
    const listing = listingsById.get(e.id);
    if (!listing || e.weight <= 0) continue;
    exemplars.push({ ...e, features: featuresOf(listing, campusMinutes) });
  }

  const summary = cleanFilterSummary(signals.filterSummary?.filters);
  const filters = Object.keys(summary).length
    ? { summary, weight: recencyWeight(signals.filterSummary.updated_at, now) }
    : null;

  const dataPoints =
    (matchmaking && matchmaking.weight >= STALE_WEIGHT ? 1 : 0) +
    exemplars.filter((e) => e.recency >= STALE_WEIGHT).length +
    (filters && filters.weight >= STALE_WEIGHT ? 1 : 0);

  return {
    matchmaking,
    exemplars,
    filters,
    contactedIds,
    gender: signals.gender ?? null,
    dataPoints,
  };
}

function isSuggestable(listing, profile) {
  if (listing.unavailable) return false;
  if (listing.leaseType === "Sublease") return false;
  if (profile.contactedIds.has(String(listing._id))) return false;
  const prefs = { ...(profile.matchmaking?.prefs ?? {}), _viewerGender: profile.gender };
  if (isListingExcludedForViewer(listing, prefs)) return false;
  const range = groupRangeOf(profile.matchmaking?.prefs?.group_size);
  if (range && range.min >= 2 && isRoomShareListing(listing)) return false;
  return true;
}

// Within one bedroom of the anchor, when both bedroom counts are known.
function nearAnchorBeds(f, anchorFeatures) {
  if (!f.beds.length || !anchorFeatures.beds.length) return true;
  return f.beds.some((b) => anchorFeatures.beds.some((a) => Math.abs(a - b) <= 1));
}

/**
 * Ranked suggestion ids for one student: 0, 2 or 4 of them (always an even
 * count so the two-column strip never shows a lone card). Empty when the
 * profile is below the data-point minimum.
 *
 * `anchor` ({ listing, ownerIds }) switches to "similar to" mode, see the top
 * of this file. `listing` is the anchor in the built shape; its features
 * should be read regardless of availability (loadAnchorListing does that).
 */
export function suggestListings({ listings, profile, campusMinutes, saturation = {}, anchor = null }) {
  if (anchor) return suggestSimilar({ listings, profile, campusMinutes, saturation, anchor });
  if (profile.dataPoints < MIN_DATA_POINTS) return [];

  const sources = profileSources(profile, campusMinutes);
  const totalWeight = sources.reduce((s, x) => s + x.weight, 0);
  if (!totalWeight) return [];

  const sat = (id) => saturation[id] ?? 0;
  const ranked = listings
    .filter((l) => isSuggestable(l, profile))
    .map((l) => {
      const f = featuresOf(l, campusMinutes);
      const score = sources.reduce((s, src) => s + src.weight * src.score(l, f), 0) / totalWeight;
      return { id: String(l._id), score };
    })
    .sort((a, b) => {
      if (Math.abs(a.score - b.score) > TIE_BAND) return b.score - a.score;
      if (sat(a.id) !== sat(b.id)) return sat(a.id) - sat(b.id);
      return b.score - a.score;
    });

  const count = Math.min(MAX_SUGGESTIONS, ranked.length);
  return ranked.slice(0, count - (count % 2)).map((r) => r.id);
}

function suggestSimilar({ listings, profile, campusMinutes, saturation, anchor }) {
  const anchorId = String(anchor.listing._id);
  const anchorFeatures = featuresOf(anchor.listing, campusMinutes);
  const ownerIds = anchor.ownerIds ?? new Set();
  const sources = profileSources(profile, campusMinutes);
  const profileWeight = sources.reduce((s, x) => s + x.weight, 0);

  const sat = (id) => saturation[id] ?? 0;
  const ranked = listings
    .filter((l) => String(l._id) !== anchorId && isSuggestable(l, profile))
    .map((l) => ({ l, f: featuresOf(l, campusMinutes) }))
    .filter(({ f }) => nearAnchorBeds(f, anchorFeatures))
    .map(({ l, f }) => {
      const resemblance = similarity(f, anchorFeatures);
      const rest = profileWeight
        ? sources.reduce((s, src) => s + src.weight * src.score(l, f), 0) / profileWeight
        : null;
      const score = rest == null ? resemblance : ANCHOR_WEIGHT * resemblance + (1 - ANCHOR_WEIGHT) * rest;
      const sameLandlord = !!l.owner?._id && ownerIds.has(String(l.owner._id));
      return { id: String(l._id), score, sameLandlord };
    })
    .sort((a, b) => {
      if (a.sameLandlord !== b.sameLandlord) return a.sameLandlord ? 1 : -1;
      if (Math.abs(a.score - b.score) > TIE_BAND) return b.score - a.score;
      if (sat(a.id) !== sat(b.id)) return sat(a.id) - sat(b.id);
      return b.score - a.score;
    });

  const count = Math.min(MAX_SUGGESTIONS, ranked.length);
  return ranked.slice(0, count - (count % 2)).map((r) => r.id);
}

// The profile's weighted scorers, one per signal present.
function profileSources(profile, campusMinutes) {
  const sources = [];
  if (profile.matchmaking) {
    sources.push({
      weight: SOURCE_WEIGHTS.matchmaking * profile.matchmaking.weight,
      score: (l, f) => scoreMatchmaking(l, f, profile.matchmaking.prefs),
    });
  }
  if (profile.exemplars.length) {
    const freshest = Math.max(...profile.exemplars.map((e) => e.recency));
    sources.push({
      weight: SOURCE_WEIGHTS.interactions * freshest,
      score: (l, f) => scoreInteractions(f, profile.exemplars),
    });
  }
  if (profile.filters) {
    sources.push({
      weight: SOURCE_WEIGHTS.filters * profile.filters.weight,
      score: (l) => scoreFilters(l, profile.filters.summary, campusMinutes),
    });
  }
  return sources;
}
