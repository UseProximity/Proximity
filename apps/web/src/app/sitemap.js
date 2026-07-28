/*
 * App Router sitemap (served at /sitemap.xml). Replaces next-sitemap, whose static
 * scan couldn't see the dynamic routes and shipped an empty file. Listing URLs come
 * from Supabase using the same availability rule as /api/listings: the listing-level
 * `unavailable` flag, or every unit marked unavailable (empty unit lists don't count).
 */
import { guides } from "@/lib/guides";

const SITE_URL = "https://useproximity.org";

// Revalidate hourly so crawler fetches don't hit the DB on every request.
export const revalidate = 3600;

const staticRoutes = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/browse", priority: 0.9, changeFrequency: "daily" },
  { path: "/matchmaking", priority: 0.8, changeFrequency: "monthly" },
  { path: "/guides", priority: 0.7, changeFrequency: "monthly" },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" },
  { path: "/CampusHub", priority: 0.6, changeFrequency: "weekly" },
  { path: "/lease-check", priority: 0.6, changeFrequency: "monthly" },
];

async function fetchListingEntries() {
  // Lazy import so a missing env var degrades to a static-only sitemap
  // instead of failing the whole route at module load.
  const { default: supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase
    .from("listings")
    .select("id, updated_at, unavailable, listing_units(available)")
    .eq("unavailable", false);
  if (error) throw error;

  return (data ?? [])
    .filter((row) => {
      const units = row.listing_units ?? [];
      return !(units.length > 0 && units.every((u) => u.available === false));
    })
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
    entries.push(...(await fetchListingEntries()));
  } catch (error) {
    // A partial sitemap beats a 500 — static routes still get advertised.
    console.error("sitemap: failed to load listings", error);
  }

  return entries;
}
