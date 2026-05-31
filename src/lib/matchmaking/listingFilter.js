import { join } from "path";
import { readFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import supabase from "@/lib/supabase";
import { LISTING_SELECT } from "@/lib/listings/listingSelect";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

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
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

function activeLeasesOf(listing) {
  return (listing.listing_leases ?? []).filter((l) => l.is_active && !l.deleted_at && l.rent > 0);
}

// Cheapest per-person option for a listing (null if no priced lease).
// NOTE: rent on a lease is stored PER PERSON already — do not divide by beds.
function minPerPerson(listing) {
  const leases = activeLeasesOf(listing);
  if (leases.length === 0) return null;
  return Math.min(...leases.map((l) => l.rent));
}

function avgReview(listing) {
  const ratings = (listing.listing_reviews ?? [])
    .filter((r) => !r.deleted_at && Number.isFinite(r.rating))
    .map((r) => r.rating);
  if (ratings.length === 0) return null;
  return Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10;
}

function topAmenitiesOf(listing) {
  const amenRow = listing.listing_amenities?.[0];
  return amenRow
    ? Object.entries(amenRow)
        .filter(([, v]) => v === true)
        .map(([k]) => k.replace(/_/g, " "))
    : [];
}

// Shortest walk (minutes) to a WashU CAMPUS location. Excludes grocery stops and
// — importantly — the `shuttle_nearest` row, which is the walk to the nearest
// shuttle STOP, not to campus (the platform treats it as a separate metric).
// Returns null when no campus walk-time data exists — the ranker must NOT guess.
function walkToCampusMin(listing) {
  const times = (listing.listing_walk_times ?? [])
    .filter((w) => {
      const name = w.locations?.name ?? "";
      return Number.isFinite(w.minutes) && name !== "shuttle_nearest" && !/grocery/i.test(name);
    })
    .map((w) => w.minutes);
  return times.length > 0 ? Math.min(...times) : null;
}

// Walk (minutes) to the nearest shuttle stop — NOT the walk to campus.
function walkToShuttleMin(listing) {
  const row = (listing.listing_walk_times ?? []).find(
    (w) => w.locations?.name === "shuttle_nearest" && Number.isFinite(w.minutes)
  );
  return row ? row.minutes : null;
}

function extractCardData(listing) {
  const hero = (listing.listing_images ?? []).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  )[0];
  return {
    title: listing.title,
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
    title: listing.title,
    address: listing.address,
    home_type: listing.home_types?.label ?? null,
    per_person_rent: Math.round(minPerPerson(listing)),
    bedrooms_max: Math.max(0, ...leases.map((l) => Number(l.bedrooms) || 0)),
    lease_term_months: [...new Set(leases.map((l) => l.lease_term_months).filter(Boolean))],
    furnished: listing.furnished ?? null,
    avg_review: avgReview(listing),
    amenities: topAmenitiesOf(listing),
    // null = no distance data on file — the ranker must not claim proximity.
    walk_to_campus_min: walkToCampusMin(listing),
    // Walk to nearest shuttle stop (then a shuttle ride to campus) — distinct
    // from walking to campus; the ranker must not conflate the two.
    walk_to_shuttle_min: walkToShuttleMin(listing),
  };
}

export async function rankListings({
  preferences,
  weights,
  requestedIntentions,
  limit = 10,
}) {
  const { data: allListings, error } = await supabase
    .from("listings")
    .select(`${LISTING_SELECT}, listing_walk_times(minutes, locations(name))`)
    .is("deleted_at", null)
    .eq("unavailable", false)
    .limit(80);

  if (error) throw new Error(`[listingFilter] Supabase fetch failed: ${error.message}`);

  const budgetMax = preferences.budget_max ?? Infinity;
  const groupSize = Number(preferences.group_size) || 1;

  // All listings with a priced active lease, scored by PER-PERSON cost + beds.
  const withLeases = (allListings ?? [])
    .map((listing) => {
      const pp = minPerPerson(listing);
      if (pp == null) return null;
      const maxBeds = Math.max(0, ...activeLeasesOf(listing).map((l) => Number(l.bedrooms) || 0));
      return { listing, perPerson: pp, maxBeds };
    })
    .filter(Boolean)
    .sort((a, b) => a.perPerson - b.perPerson);

  // Strict filter on per-person budget + enough bedrooms for the group.
  const pruned = withLeases.filter(
    ({ perPerson, maxBeds }) =>
      (budgetMax === Infinity || perPerson <= budgetMax) && maxBeds >= groupSize
  );

  // Give the model enough to choose from. Prefer the strict set; if it's too
  // small, fall back to the cheapest per-person listings (budget enforced later).
  const pool = (pruned.length >= limit ? pruned : withLeases).slice(0, 30).map((x) => x.listing);

  if (pool.length === 0) {
    return { ranked: [], usage: null };
  }

  const perPersonById = Object.fromEntries(pool.map((l) => [l.id, minPerPerson(l)]));
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
    candidates: pool.map(slimCandidate),
    requestedIntentions: effectiveIntentions,
    limit,
    instruction:
      "Use per_person_rent (already per person). Treat houses and apartments equally. Only use an intention label the chosen listing truly earns. Respond with JSON only — no prose, no markdown fences.",
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

  // The top pick ("Best overall match") must be within budget if any pick is.
  swapToSatisfy(enriched.findIndex((r) => r.intention === "Best overall match"), withinBudget);

  // Data-backed intentions must land on a listing that actually has the data —
  // never label a 0-amenity listing "Most amenities", etc.
  swapToSatisfy(enriched.findIndex((r) => r.intention === "Most amenities"), hasAmenities);
  swapToSatisfy(enriched.findIndex((r) => r.intention === "Best reviews"), hasReview);
  swapToSatisfy(enriched.findIndex((r) => r.intention === "Closest to campus"), hasWalk);

  return { ranked: enriched.slice(0, limit), usage: response.usage };
}
