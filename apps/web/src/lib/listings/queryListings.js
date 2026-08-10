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
