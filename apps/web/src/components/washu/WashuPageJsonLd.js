import { serializeJsonLd } from "@/lib/jsonLd";

const SITE_URL = "https://useproximity.org";

/*
 * Server component emitting BreadcrumbList + ItemList + FAQPage structured
 * data for a /washu landing page. Renders nothing visible.
 *
 * Only rendered when the page meets the inventory threshold (thin pages are
 * noindexed and must not carry rich markup). The FAQ entries are the same
 * question/answer text visibly rendered on the page (Google parity rule), and
 * the publisher is the Organization only: these pages carry no personal
 * author by design. Note FAQ rich-result display in Google SERPs has been
 * restricted to well-known authority sites since 2023; this markup is for
 * answer-engine extraction, not the SERP widget.
 */
export default function WashuPageJsonLd({ page, content, listings }) {
  const url = `${SITE_URL}/washu/${page.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
          {
            "@type": "ListItem",
            position: 2,
            name: "WashU Off-Campus Housing",
            item: `${SITE_URL}/washu`,
          },
          { "@type": "ListItem", position: 3, name: page.h1, item: url },
        ],
      },
      {
        "@type": "ItemList",
        "@id": `${url}#listings`,
        name: page.h1,
        numberOfItems: listings.length,
        itemListElement: listings.map((l, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: l.title || l.address?.split(",")[0]?.trim() || "Listing",
          url: `${SITE_URL}/listings/${l._id}`,
        })),
      },
      ...(content?.faqs?.length
        ? [
            {
              "@type": "FAQPage",
              "@id": `${url}#faq`,
              mainEntity: content.faqs.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: f.a },
              })),
            },
          ]
        : []),
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
    />
  );
}
