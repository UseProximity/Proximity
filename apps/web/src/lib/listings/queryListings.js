import { unstable_cache } from "next/cache";
import { fetchListings } from "@/app/api/listings/route";
import { getPopularListings } from "@/app/api/listings/popular/route";

/*
 * Server-side listing data for pages that render listings in their initial
 * HTML (/, /browse, and the /washu landing pages). Wraps the API route's
 * fetchListings() in a short-lived shared cache so dynamic pages (auth()
 * forces per-request rendering) don't each pay a full Supabase join.
 *
 * Returns [] on failure — server pages seed the client with "no data yet"
 * and the client components' own fetch takes over, matching old behavior.
 */
const cachedFetch = unstable_cache(
  async () => fetchListings(),
  ["all-listings"],
  { revalidate: 300, tags: ["listings"] }
);

export async function getCachedListings() {
  try {
    return await cachedFetch();
  } catch (err) {
    console.error("[getCachedListings] failed:", err?.message ?? err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// /washu landing-page slices
// ---------------------------------------------------------------------------

import { minPerPersonRent } from "@/lib/listings/rentBasis";
import { neighborhoodOfListing, NEIGHBORHOODS } from "@/lib/geo/neighborhoods";
import { WASHU_PLACES, NON_CAMPUS_WALK_PLACES } from "@/utils/washuPlaces";

// Pages with fewer than this many qualifying listings render but are
// noindexed AND excluded from the sitemap + related-links (one function, both
// gates, so they can never disagree).
export const MIN_INVENTORY = 5;

function matchesPageFilter(listing, filter) {
  if (filter.bedrooms != null) {
    // `u.bedrooms != null` first: buildListing emits null for an unsized unit,
    // and Number(null) is 0 — so every unit with an unknown bedroom count would
    // qualify as a studio and appear on /washu/studio-apartments, including in
    // that page's ItemList JSON-LD.
    return (listing.unitTypes ?? []).some(
      (u) =>
        u.available !== false &&
        u.bedrooms != null &&
        Number(u.bedrooms) === filter.bedrooms
    );
  }
  if (filter.maxPerPerson != null) {
    const per = minPerPersonRent(listing);
    return per != null && per <= filter.maxPerPerson;
  }
  if (filter.neighborhood) {
    // Municipalities (University City, Clayton) also match by the city named
    // in the address; districts rely on nearest-centroid alone.
    const area = NEIGHBORHOODS.find((n) => n.key === filter.neighborhood);
    if (area?.addressMatch?.test(listing.address ?? "")) return true;
    return neighborhoodOfListing(listing)?.key === filter.neighborhood;
  }
  return false;
}

/**
 * Qualifying available listings for one /washu page definition, sorted
 * reviewed-first (rating desc) then by walk time to campus. Shared by the
 * page body, its metadata, its JSON-LD, and the sitemap.
 */
export async function getWashuPageListings(pageDef) {
  const all = await getCachedListings();
  const listings = all
    .filter((l) => !l.unavailable && matchesPageFilter(l, pageDef.filter))
    .sort((a, b) => {
      if ((b.numReviews > 0) !== (a.numReviews > 0))
        return b.numReviews > 0 ? 1 : -1;
      if (b.rating !== a.rating) return b.rating - a.rating;
      const wa = campusWalkMinutes(a) ?? Infinity;
      const wb = campusWalkMinutes(b) ?? Infinity;
      return wa - wb;
    });
  return {
    listings,
    count: listings.length,
    meetsThreshold: listings.length >= MIN_INVENTORY,
  };
}

// Minimum walk-minutes to campus for a built listing, using the same
// campus-place set as the /browse distance filter (grocery + Med Campus
// excluded via NON_CAMPUS_WALK_PLACES).
function campusWalkMinutes(listing) {
  const pwm = listing?.placeWalkMinutes;
  if (!pwm || typeof pwm !== "object") return null;
  const campusMins = WASHU_PLACES.filter(
    (p) => !NON_CAMPUS_WALK_PLACES.includes(p.name)
  )
    .map((p) => pwm[p.name])
    .filter((m) => m != null);
  return campusMins.length ? Math.min(...campusMins) : null;
}

export function walkMinutesRange(listings) {
  const vals = listings
    .map((l) => campusWalkMinutes(l))
    .filter((v) => v != null);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

const cachedPopular = unstable_cache(
  async () => getPopularListings(),
  ["popular-listings"],
  { revalidate: 300, tags: ["listings"] }
);

export async function getCachedPopularListings() {
  try {
    return await cachedPopular();
  } catch (err) {
    console.error("[getCachedPopularListings] failed:", err?.message ?? err);
    return [];
  }
}
