/*
 * Property context for Lease Check: geocode the extracted address, match it to a
 * Proximity listing, and pull reviews + cheaper comps.
 *
 * The whole point of the confidence gate: a wrong-building match that attributes
 * someone else's bad reviews to a student's lease is the worst failure mode this
 * feature has. Only a 'high' confidence match (within 200m AND exact street-number
 * match) renders the property panel automatically.
 */
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import supabase from "@/lib/supabase";
import { haversineKm } from "@/utils/walkTimes";
import { perPersonPerMonth, Anthropic } from "@/lib/leaseCheck/analyzeLease";

const MATCH_RADIUS_KM = 0.2; // ~200m
const COMPS_RADIUS_KM = 1.5;
const RENT_CONFIDENCE_FLOOR = 0.7;

// Local copy of the private geocodeAddress in addListing/route.js — deliberately not
// shared (that one is private to its route; this codebase duplicates such helpers).
async function geocodeAddress(address) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=1&country=US`;
  const res = await fetch(url);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.center;
  return { latitude: lat, longitude: lng };
}

function streetNumberOf(address) {
  const match = (address || "").trim().match(/^(\d+)/);
  return match ? match[1] : null;
}

// Bounding-box deltas for a radius in km. 1 deg latitude ~= 111km; longitude shrinks
// by cos(latitude).
function bboxAround(lat, lng, radiusKm) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

async function listingsNear(lat, lng, radiusKm) {
  const box = bboxAround(lat, lng, radiusKm);
  const { data, error } = await supabase
    .from("listings")
    .select("id, title, address, latitude, longitude, min_rent, min_bedrooms, min_area, unavailable")
    .is("deleted_at", null)
    .gte("latitude", box.minLat)
    .lte("latitude", box.maxLat)
    .gte("longitude", box.minLng)
    .lte("longitude", box.maxLng);
  if (error) throw error;
  return (data || [])
    .filter((l) => l.latitude != null && l.longitude != null)
    .map((l) => ({ ...l, distanceKm: haversineKm(lat, lng, l.latitude, l.longitude) }))
    .filter((l) => l.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/*
 * Match an address to a listing.
 * 'high'  — within 200m AND leading street numbers match exactly.
 * 'low'   — within 200m, no street-number match.
 * 'none'  — nothing within 200m (or the address didn't geocode).
 */
export async function matchListing(address) {
  const geo = await geocodeAddress(address);
  if (!geo) return { confidence: "none", listing: null, geo: null };

  const nearby = await listingsNear(geo.latitude, geo.longitude, MATCH_RADIUS_KM);
  if (nearby.length === 0) return { confidence: "none", listing: null, geo };

  const leaseNumber = streetNumberOf(address);
  const numberMatch = leaseNumber
    ? nearby.find((l) => streetNumberOf(l.address) === leaseNumber)
    : null;

  if (numberMatch) return { confidence: "high", listing: numberMatch, geo };
  return { confidence: "low", listing: nearby[0], geo };
}

async function reviewsForListings(listingIds, cap = 3) {
  const { data, error } = await supabase
    .from("listing_reviews")
    .select("rating, comment, created_at, listing_id")
    .in("listing_id", listingIds)
    .eq("legitimacy", true)
    .is("deleted_at", null)
    .lte("rating", 3)
    .order("created_at", { ascending: false })
    .limit(cap);
  if (error) throw error;
  return data || [];
}

// Reviews for the matched listing + the primary landlord's other properties.
export async function getReviews(listing) {
  const { data: aggregates } = await supabase.rpc("fn_get_listing_aggregates", {
    p_listing_ids: [listing.id],
  });
  const agg = Array.isArray(aggregates) ? aggregates[0] : aggregates;

  const listingReviews = await reviewsForListings([listing.id]);

  // Landlord-level: resolve the primary landlord, then that user's other listings.
  // If the landlord has no Proximity account this degrades to just the listing's own
  // reviews — render less rather than inferring (never bucket by email domain here).
  let landlordReviews = [];
  const { data: primary } = await supabase
    .from("listing_landlords")
    .select("user_id")
    .eq("listing_id", listing.id)
    .eq("is_primary", true)
    .maybeSingle();

  if (primary?.user_id) {
    const { data: otherListings } = await supabase
      .from("listing_landlords")
      .select("listing_id")
      .eq("user_id", primary.user_id)
      .neq("listing_id", listing.id);
    const otherIds = (otherListings || []).map((r) => r.listing_id);
    if (otherIds.length > 0) {
      landlordReviews = await reviewsForListings(otherIds);
    }
  }

  return {
    avgRating: agg?.avg_rating ?? null,
    reviewCount: agg?.review_count ?? 0,
    lowReviews: listingReviews.map(({ rating, comment, created_at }) => ({
      rating,
      comment,
      createdAt: created_at,
    })),
    landlordReviews: landlordReviews.map(({ rating, comment, created_at }) => ({
      rating,
      comment,
      createdAt: created_at,
    })),
  };
}

/*
 * Landlord/company-name lookup: the student typed the name themselves, so attribution
 * risk sits on their input (same spirit as the manual address correction).
 *
 * Two stages:
 *   1. Broad candidate retrieval: token ilike over listings.contact_name AND
 *      contact_email (an email domain like clocktowerstl.com should match a search
 *      for "Clocktower"), plus landlord users' names/emails via listing_landlords.
 *   2. Claude Haiku filters the candidates to the ones that clearly belong to the
 *      named company; when unsure it excludes. Falls back to a strict name match
 *      if the model call fails. Returns null when nothing survives.
 */
const RETRIEVAL_STOPWORDS = new Set([
  "llc", "inc", "co", "the", "and", "company", "companies", "property", "properties",
  "management", "mgmt", "realty", "group", "apartments", "housing", "homes", "rentals",
]);

const LandlordMatchSchema = z.object({
  matchingListingIds: z.array(z.string()),
});

let _matcherClient = null;
function getMatcherClient() {
  if (!_matcherClient) _matcherClient = new Anthropic({ apiKey: process.env.LEASE_SCANNER_KEY });
  return _matcherClient;
}

function searchTokens(name) {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !RETRIEVAL_STOPWORDS.has(t));
  return tokens.length > 0 ? tokens : [name.toLowerCase().replace(/\s+/g, "")];
}

async function findLandlordCandidates(name) {
  const tokens = searchTokens(name);
  const listingOr = tokens
    .flatMap((t) => [`contact_name.ilike.%${t}%`, `contact_email.ilike.%${t}%`])
    .join(",");

  const { data: byContact } = await supabase
    .from("listings")
    .select("id, title, contact_name, contact_email")
    .or(listingOr)
    .is("deleted_at", null)
    .limit(100);

  const userOr = tokens.flatMap((t) => [`name.ilike.%${t}%`, `email.ilike.%${t}%`]).join(",");
  const { data: matchedUsers } = await supabase
    .from("users")
    .select("id, name, email")
    .or(userOr)
    .is("deleted_at", null)
    .limit(30);

  const candidates = new Map();
  for (const l of byContact || []) {
    candidates.set(l.id, {
      id: l.id,
      title: l.title,
      contactName: l.contact_name,
      contactEmail: l.contact_email,
      landlordAccount: null,
    });
  }

  if (matchedUsers?.length) {
    const { data: joins } = await supabase
      .from("listing_landlords")
      .select("listing_id, user_id")
      .in("user_id", matchedUsers.map((u) => u.id));
    const userById = Object.fromEntries(matchedUsers.map((u) => [u.id, u]));
    const extraIds = (joins || []).map((j) => j.listing_id).filter((id) => !candidates.has(id));
    let extraListings = [];
    if (extraIds.length > 0) {
      const { data } = await supabase
        .from("listings")
        .select("id, title, contact_name, contact_email")
        .in("id", extraIds)
        .is("deleted_at", null);
      extraListings = data || [];
    }
    for (const l of extraListings) {
      candidates.set(l.id, {
        id: l.id,
        title: l.title,
        contactName: l.contact_name,
        contactEmail: l.contact_email,
        landlordAccount: null,
      });
    }
    for (const j of joins || []) {
      const candidate = candidates.get(j.listing_id);
      const u = userById[j.user_id];
      if (candidate && u) candidate.landlordAccount = { name: u.name, email: u.email };
    }
  }

  return [...candidates.values()];
}

const MATCHER_SYSTEM = `You match a landlord or property-management company name (typed by a student) against candidate rental listings. Return the ids of listings that clearly belong to that company.

A listing belongs if any of these hold:
- Its contact name is that company (including abbreviations, "The X Company" vs "X", suffix differences like LLC/Properties/Management).
- Its contact email's domain is derived from the company name (e.g. "Clocktower" matches max@clocktowerstl.com or leasing@theclocktowercompany.com).
- Its landlord account name or email matches the same way.

Rules:
- Generic mail domains (gmail, yahoo, outlook, hotmail, icloud, aol) prove nothing by themselves; for those, require the name or the email's local part to match the company.
- A shared generic word is not a match ("City Properties" does not match "City Lights Apartments").
- When unsure, EXCLUDE. A wrong match shows a student someone else's reviews, which is worse than showing nothing.`;

async function filterCandidatesWithModel(name, candidates) {
  const client = getMatcherClient();
  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 1000,
    output_config: { format: zodOutputFormat(LandlordMatchSchema) },
    system: [{ type: "text", text: MATCHER_SYSTEM }],
    messages: [
      {
        role: "user",
        content: `Company the student typed: "${name}"\n\nCandidates:\n${JSON.stringify(candidates, null, 2)}`,
      },
    ],
  });
  const parsed = response.parsed_output;
  if (!parsed) return null;
  const valid = new Set(candidates.map((c) => c.id));
  return parsed.matchingListingIds.filter((id) => valid.has(id));
}

export async function getLandlordReviewsByName(rawName) {
  const name = (rawName || "").trim().replace(/[%_,()]/g, "");
  if (name.length < 3) return null;

  const candidates = await findLandlordCandidates(name);
  if (candidates.length === 0) return null;

  let listingIds = null;
  try {
    listingIds = await filterCandidatesWithModel(name, candidates);
  } catch (error) {
    console.error("[lease-check] landlord matcher model failed:", error?.message);
  }
  if (listingIds == null) {
    // Deterministic fallback: strict name containment only.
    const q = name.toLowerCase();
    listingIds = candidates
      .filter((c) => (c.contactName || "").toLowerCase().includes(q))
      .map((c) => c.id);
  }
  listingIds = listingIds.slice(0, 30);
  if (listingIds.length === 0) return null;

  const matchedExamples = [
    ...new Set(
      candidates
        .filter((c) => listingIds.includes(c.id))
        .map((c) => c.contactName || c.contactEmail?.split("@")[1] || c.landlordAccount?.name)
        .filter(Boolean)
    ),
  ].slice(0, 3);

  const { data: aggregates } = await supabase.rpc("fn_get_listing_aggregates", {
    p_listing_ids: listingIds,
  });
  const aggRows = Array.isArray(aggregates) ? aggregates : aggregates ? [aggregates] : [];
  const reviewCount = aggRows.reduce((sum, r) => sum + (r.review_count ?? 0), 0);
  const weighted = aggRows.reduce(
    (sum, r) => sum + (r.avg_rating ?? 0) * (r.review_count ?? 0),
    0
  );

  const reviews = await reviewsForListings(listingIds, 5);

  return {
    query: name,
    listingCount: listingIds.length,
    matchedExamples,
    reviewCount,
    avgRating: reviewCount > 0 ? weighted / reviewCount : null,
    lowReviews: reviews.map(({ rating, comment, created_at }) => ({
      rating,
      comment,
      createdAt: created_at,
    })),
  };
}

/*
 * Cheaper comps near the lease. Skips entirely (returns null) unless rent AND bedrooms
 * were confidently extracted — a missing comps section costs nothing; a wrong one costs
 * the student's trust. min_rent here is the trigger-maintained aggregate (the listing's
 * lowest advertised monthly per-person rate); never recompute it from unit joins.
 */
export async function getComps({ geo, matchedListingId, rent, bedrooms }) {
  if (!rent || bedrooms == null || (rent.confidence ?? 0) < RENT_CONFIDENCE_FLOOR) return null;

  const leasePerPerson = perPersonPerMonth(rent);
  if (leasePerPerson == null || !Number.isFinite(leasePerPerson) || leasePerPerson <= 0) return null;

  const nearby = await listingsNear(geo.latitude, geo.longitude, COMPS_RADIUS_KM);
  const qualifying = nearby.filter(
    (l) =>
      l.id !== matchedListingId &&
      l.unavailable === false &&
      l.min_rent != null &&
      Number(l.min_rent) < leasePerPerson &&
      l.min_bedrooms != null &&
      l.min_bedrooms >= bedrooms
  );

  const top = qualifying.sort((a, b) => Number(a.min_rent) - Number(b.min_rent)).slice(0, 3);
  if (top.length === 0) return null;

  // Precomputed walk times only — never compute live (the Mapbox Directions path throws).
  const { data: walkRows } = await supabase
    .from("listing_walk_times")
    .select("listing_id, minutes, locations(name)")
    .in("listing_id", top.map((l) => l.id));

  const walkByListing = {};
  for (const row of walkRows || []) {
    const current = walkByListing[row.listing_id];
    if (!current || row.minutes < current.minutes) {
      walkByListing[row.listing_id] = { minutes: row.minutes, place: row.locations?.name ?? null };
    }
  }

  return {
    leasePerPersonPerMonth: Math.round(leasePerPerson),
    comps: top.map((l) => ({
      id: l.id,
      title: l.title,
      address: l.address,
      perPersonRent: Math.round(Number(l.min_rent)),
      bedrooms: l.min_bedrooms,
      distanceKm: Math.round(l.distanceKm * 10) / 10,
      walk: walkByListing[l.id] ?? null,
    })),
  };
}

/*
 * Full context pipeline for an extracted analysis. Never throws — property context is
 * a bonus section; a failure here must not fail the analysis response.
 */
export async function buildPropertyContext(analysis) {
  try {
    if (!analysis?.address) return { matchConfidence: "none", listing: null, reviews: null, comps: null };

    const { confidence, listing, geo } = await matchListing(analysis.address);

    // Only a high-confidence match gets reviews/comps rendered automatically; low/none
    // get just the "tell us where" affordance client-side.
    if (confidence !== "high" || !listing || !geo) {
      return { matchConfidence: confidence, listing: null, reviews: null, comps: null };
    }

    const [reviews, comps] = await Promise.all([
      getReviews(listing),
      getComps({ geo, matchedListingId: listing.id, rent: analysis.rent, bedrooms: analysis.bedrooms }),
    ]);

    return {
      matchConfidence: "high",
      listing: { id: listing.id, title: listing.title, address: listing.address },
      reviews,
      comps,
    };
  } catch (error) {
    console.error("[lease-check] property context failed:", error);
    return { matchConfidence: "none", listing: null, reviews: null, comps: null };
  }
}
