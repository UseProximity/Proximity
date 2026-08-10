import Link from "next/link";
import { washuPages } from "@/lib/washuPages";
import { washuContent } from "@/content/washu";
import { getWashuPageListings } from "@/lib/listings/queryListings";
import { serializeJsonLd } from "@/lib/jsonLd";

export const revalidate = 3600;

const SITE_URL = "https://useproximity.org";

export const metadata = {
  title: "WashU Off-Campus Housing: Apartments, Rents & Student Reviews | Proximity",
  description:
    "The WashU off-campus housing hub: apartments by neighborhood, bedroom count, and budget, with walk times to campus and honest reviews from WashU students.",
  alternates: { canonical: "/washu" },
  openGraph: {
    title: "WashU Off-Campus Housing | Proximity",
    description:
      "Apartments near WashU by neighborhood, bedroom count, and budget, with walk times and honest student reviews.",
    url: "/washu",
  },
};

const KIND_LABELS = {
  neighborhood: "By neighborhood",
  beds: "By bedroom count",
  price: "By budget",
};

export default async function WashuHubPage() {
  const content = washuContent._pillar;

  // Same threshold gate as the child pages and the sitemap: thin pages are
  // omitted from the hub links so noindexed pages collect no internal links.
  const withCounts = await Promise.all(
    washuPages.map(async (p) => ({
      page: p,
      result: await getWashuPageListings(p),
    }))
  );
  const indexable = withCounts.filter(({ result }) => result.meetsThreshold);

  const grouped = { neighborhood: [], beds: [], price: [] };
  for (const item of indexable) grouped[item.page.kind]?.push(item);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        "@id": `${SITE_URL}/washu#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
          {
            "@type": "ListItem",
            position: 2,
            name: "WashU Off-Campus Housing",
            item: `${SITE_URL}/washu`,
          },
        ],
      },
      {
        "@type": "CollectionPage",
        "@id": `${SITE_URL}/washu`,
        name: "WashU Off-Campus Housing",
        description: metadata.description,
        url: `${SITE_URL}/washu`,
      },
      ...(content?.faqs?.length
        ? [
            {
              "@type": "FAQPage",
              "@id": `${SITE_URL}/washu#faq`,
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
    <main className="min-h-screen bg-white text-gray-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-5">
          WashU off-campus housing
        </h1>
        <p className="text-lg text-gray-800 leading-relaxed max-w-3xl mb-8 font-medium">
          {content.directAnswer}
        </p>

        <section className="max-w-3xl mb-12">
          {content.intro.map((paragraph, i) => (
            <p key={i} className="text-gray-700 leading-relaxed mb-4">
              {paragraph}
            </p>
          ))}
        </section>

        {["neighborhood", "beds", "price"].map((kind) =>
          grouped[kind].length ? (
            <section key={kind} className="mb-10">
              <h2 className="text-2xl font-bold mb-4">{KIND_LABELS[kind]}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {grouped[kind].map(({ page, result }) => (
                  <Link
                    key={page.slug}
                    href={`/washu/${page.slug}`}
                    className="rounded-2xl border border-gray-200 p-5 hover:border-red-300 hover:shadow-md transition group"
                  >
                    <p className="font-semibold text-gray-900 group-hover:text-red-600 transition mb-1">
                      {page.h1}
                    </p>
                    <p className="text-sm text-gray-500">
                      {result.count} listing{result.count === 1 ? "" : "s"}{" "}
                      available now
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null
        )}

        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">Guides worth your time</h2>
          <ul className="space-y-2">
            <li>
              <Link href="/guides/washu-off-campus-budget" className="text-red-600 font-medium hover:text-red-700">
                How much to budget for rent near WashU
              </Link>
            </li>
            <li>
              <Link href="/guides/washu-apartment-checklist" className="text-red-600 font-medium hover:text-red-700">
                The questions to ask before signing a lease
              </Link>
            </li>
            <li>
              <Link href="/guides/four-types-washu-housing" className="text-red-600 font-medium hover:text-red-700">
                The 4 types of off-campus housing near WashU
              </Link>
            </li>
            <li>
              <Link href="/guides" className="text-red-600 font-medium hover:text-red-700">
                All housing guides
              </Link>
            </li>
          </ul>
        </section>

        {content.faqs?.length ? (
          <section className="max-w-3xl mb-12">
            <h2 className="text-2xl font-bold mb-6">Questions students ask</h2>
            {content.faqs.map((f, i) => (
              <div key={i} className="mb-6">
                <h3 className="text-lg font-semibold mb-2">{f.q}</h3>
                <p className="text-gray-700 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </section>
        ) : null}

        <section className="rounded-2xl bg-gray-900 px-8 py-10 text-center mb-10">
          <h2 className="text-3xl font-black text-white mb-3">
            Skip the search. Get matched.
          </h2>
          <p className="text-gray-300 mb-6 max-w-xl mx-auto">
            Tell us your budget, move-in date, and vibe. Free matchmaking built
            by WashU students who know these blocks.
          </p>
          <Link
            href="/matchmaking"
            className="inline-flex items-center justify-center rounded-xl bg-red-600 px-6 py-3 font-semibold text-white hover:bg-red-700 transition"
          >
            Get matched free
          </Link>
        </section>

        {content.benchmarkNote ? (
          <p className="text-xs text-gray-400 max-w-3xl">
            {content.benchmarkNote}
          </p>
        ) : null}
      </div>
    </main>
  );
}
