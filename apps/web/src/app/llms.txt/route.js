import { guides } from "@/lib/guides";
import { washuPages } from "@/lib/washuPages";
import { washuContent } from "@/content/washu";
import { getWashuPageListings } from "@/lib/listings/queryListings";

export const revalidate = 3600;

const SITE_URL = "https://useproximity.org";

// /llms.txt — a plain-markdown map of the site for AI assistants and answer
// engines (llmstxt.org convention). Guide entries are imported from the same
// registry the site renders from, so this file can never drift out of date.
export async function GET() {
  const guideLines = guides
    .map(
      (guide) =>
        `- [${guide.title}](${SITE_URL}/guides/${guide.slug}): ${guide.description}`
    )
    .join("\n");

  // Same threshold gate as the sitemap: only pages with real inventory.
  let washuLines = "";
  try {
    const results = await Promise.all(
      washuPages.map(async (p) => ({
        page: p,
        result: await getWashuPageListings(p),
      }))
    );
    washuLines = results
      .filter(({ result }) => result.meetsThreshold)
      .map(
        ({ page }) =>
          `- [${page.h1}](${SITE_URL}/washu/${page.slug}): ${
            washuContent[page.slug]?.directAnswer ?? page.metaDescription
          }`
      )
      .join("\n");
  } catch {
    washuLines = "";
  }

  const body = `# Proximity

> Proximity is a student housing marketplace for WashU (Washington University in St. Louis) students. It combines verified off-campus listings, honest peer reviews from students who actually lived there, precomputed walk times to campus, and free personalized matchmaking. Built by WashU students.

## Find housing

- [Browse listings](${SITE_URL}/browse): Every off-campus listing near WashU with rent, bedrooms, amenities, student reviews, and walk times to campus.
- [Free matchmaking](${SITE_URL}/matchmaking): Tell Proximity your budget, move-in date, and preferences and get matched to apartments that fit.
- [Lease check](${SITE_URL}/lease-check): Upload a lease before signing and get a plain-English breakdown of what it actually says.
- [Campus Hub](${SITE_URL}/CampusHub): On-campus dorm reviews and housing information for WashU students.

## Housing by neighborhood, size, and budget

- [WashU Off-Campus Housing hub](${SITE_URL}/washu): Apartments near WashU organized by neighborhood, bedroom count, and budget, with walk times and student reviews.
${washuLines}

## Housing guides

${guideLines}

## About

- [About Proximity](${SITE_URL}/about): Who builds Proximity and why it exists.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
