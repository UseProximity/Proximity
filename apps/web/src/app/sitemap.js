/*
 * App Router sitemap (served at /sitemap.xml). Replaces next-sitemap, whose static
 * scan couldn't see the dynamic routes and shipped an empty file.
 *
 * Listing URLs match what /api/listings serves publicly, which means BOTH filters
 * that route applies:
 *   - not soft-deleted (`deleted_at is null`)
 *   - available: the listing-level `unavailable` flag is false, and it is not the
 *     case that every one of its units is unavailable (empty unit lists don't count)
 * Advertising a soft-deleted listing would ask Google to index removed inventory,
 * and /listings/[id] still renders those rows — so this filter is load-bearing.
 */
import { guides } from "@/lib/guides";
import { washuPages } from "@/lib/washuPages";
import { listingIsUnavailable } from "@/lib/listings/unitAvailability";

const SITE_URL = "https://useproximity.org";

// Revalidate hourly so crawler fetches don't hit the DB on every request.
export const revalidate = 3600;

// PostgREST caps a single response at Supabase's db_max_rows (1000 by default),
// and .limit() above that is clamped rather than honoured — so page explicitly.
// Without this the sitemap would silently drop listings past the first 1000.
const PAGE_SIZE = 1000;

const staticRoutes = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/browse", priority: 0.9, changeFrequency: "daily" },
  { path: "/matchmaking", priority: 0.8, changeFrequency: "monthly" },
  { path: "/guides", priority: 0.7, changeFrequency: "monthly" },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" },
  { path: "/CampusHub", priority: 0.6, changeFrequency: "weekly" },
  { path: "/lease-check", priority: 0.6, changeFrequency: "monthly" },
  { path: "/washu", priority: 0.8, changeFrequency: "weekly" },
];

// /washu child pages enter the sitemap only when they meet the same
// inventory threshold that flips their robots meta to index — one gate,
// both places, so they can never disagree.
async function fetchWashuEntries() {
  // Lazy, for the same reason fetchListingEntries is: queryListings reaches
  // @/lib/supabase, which throws from its module body when the DB env vars are
  // missing. Imported at the top of this file that throw happens at module
  // evaluation, before either try/catch below can run — killing the whole route
  // rather than degrading to a static sitemap.
  const { getWashuPageListings } = await import("@/lib/listings/queryListings");
  const results = await Promise.all(
    washuPages.map(async (page) => ({
      page,
      result: await getWashuPageListings(page),
    }))
  );
  return results
    .filter(({ result }) => result.meetsThreshold)
    .map(({ page }) => ({
      url: `${SITE_URL}/washu/${page.slug}`,
      lastModified: new Date(page.dateModified),
      changeFrequency: "weekly",
      priority: 0.7,
    }));
}

async function fetchListingEntries() {
  // Lazy import so a missing env var degrades to a static-only sitemap
  // instead of failing the whole route at module load.
  const { default: supabase } = await import("@/lib/supabase");

  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("listings")
      .select("id, updated_at, unavailable, listing_units(unit_leases(is_active, unavailable))")
      .is("deleted_at", null)
      .eq("unavailable", false)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }

  return rows
    .filter((row) => !listingIsUnavailable(row))
    .map((row) => ({
      url: `${SITE_URL}/listings/${row.id}`,
      ...(row.updated_at ? { lastModified: new Date(row.updated_at) } : {}),
      changeFrequency: "weekly",
      priority: 0.8,
    }));
}

export default async function sitemap() {
  const entries = [
    ...staticRoutes.map(({ path, priority, changeFrequency }) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency,
      priority,
    })),
    ...guides.map((guide) => ({
      url: `${SITE_URL}/guides/${guide.slug}`,
      changeFrequency: "monthly",
      priority: 0.7,
    })),
  ];

  try {
    entries.push(...(await fetchWashuEntries()));
  } catch (error) {
    console.error("sitemap: failed to load /washu pages", error);
  }

  try {
    entries.push(...(await fetchListingEntries()));
  } catch (error) {
    // A partial sitemap beats a 500 — static routes still get advertised.
    console.error("sitemap: failed to load listings", error);
  }

  return entries;
}
