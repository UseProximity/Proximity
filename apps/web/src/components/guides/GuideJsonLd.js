import { guides } from "@/lib/guides";
import { serializeJsonLd } from "@/lib/jsonLd";

const SITE_URL = "https://useproximity.org";

/*
 * Server component emitting BlogPosting + BreadcrumbList structured data for a
 * guide article. Renders nothing visible. Dates come from lib/guides.js and
 * must stay consistent with any visible "Updated ..." text on the page.
 */
export default function GuideJsonLd({ slug }) {
  const guide = guides.find((g) => g.slug === slug);
  if (!guide) return null;

  const url = `${SITE_URL}/guides/${guide.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${url}#article`,
        mainEntityOfPage: url,
        headline: guide.title,
        description: guide.description,
        image: `${SITE_URL}${guide.image}`,
        author: {
          "@type": "Person",
          name: "Ben Flicker",
          jobTitle: "Founder",
          affiliation: { "@id": `${SITE_URL}/#organization` },
        },
        publisher: { "@id": `${SITE_URL}/#organization` },
        ...(guide.datePublished ? { datePublished: guide.datePublished } : {}),
        ...(guide.dateModified ? { dateModified: guide.dateModified } : {}),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guides` },
          { "@type": "ListItem", position: 3, name: guide.title, item: url },
        ],
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
    />
  );
}
