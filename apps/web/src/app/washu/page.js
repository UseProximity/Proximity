import Link from "next/link";
import WashuFaqLinks from "@/components/washu/WashuFaqLinks";
import { washuPages } from "@/lib/washuPages";
import { washuContent } from "@/content/washu";
import { getWashuPageListings } from "@/lib/listings/queryListings";
import { serializeJsonLd } from "@/lib/jsonLd";

export const revalidate = 3600;

const SITE_URL = "https://useproximity.org";

export const metadata = {
  title:
    "WashU Off-Campus Housing: Apartments, Rents & Student Reviews | Proximity",
  description:
    "The WashU (WUSTL) off-campus housing hub: apartments by neighborhood, bedroom count, and budget, with walk times and honest reviews from WashU students.",
  alternates: { canonical: "/washu" },
  openGraph: {
    title: "WashU Off-Campus Housing | Proximity",
    description:
      "Apartments near WashU (WUSTL) by neighborhood, bedroom count, and budget, with walk times and honest student reviews.",
    url: "/washu",
  },
};

const KIND_LABELS = {
  neighborhood: "By neighborhood",
  beds: "By bedroom count",
  price: "By budget",
  sublease: "Subleases",
  answer: "Money, timing, and how it works",
};

export default async function WashuHubPage() {
  const content = washuContent._pillar;

  // Same threshold gate as the child pages and the sitemap: thin pages are
  // omitted from the hub links so noindexed pages collect no internal links.
  const withCounts = await Promise.all(
    washuPages.map(async (p) => ({
      page: p,
      result: await getWashuPageListings(p),
    })),
  );
  const indexable = withCounts.filter(({ result }) => result.meetsThreshold);

  const grouped = {
    neighborhood: [],
    beds: [],
    price: [],
    sublease: [],
    answer: [],
  };
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

        {["neighborhood", "beds", "price", "sublease", "answer"].map((kind) =>
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
                      {page.filter
                        ? `${result.count} listing${result.count === 1 ? "" : "s"} available now`
                        : "Straight answers, real sources"}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null,
        )}

        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4">Guides worth your time</h2>
          <ul className="space-y-2">
            <li>
              <Link
                href="/guides/washu-off-campus-budget"
                className="text-red-600 font-medium hover:text-red-700"
              >
                How much to budget for rent near WashU
              </Link>
            </li>
            <li>
              <Link
                href="/guides/washu-apartment-checklist"
                className="text-red-600 font-medium hover:text-red-700"
              >
                The questions to ask before signing a lease
              </Link>
            </li>
            <li>
              <Link
                href="/guides/four-types-washu-housing"
                className="text-red-600 font-medium hover:text-red-700"
              >
                The 4 types of off-campus housing near WashU
              </Link>
            </li>
            <li>
              <Link
                href="/guides"
                className="text-red-600 font-medium hover:text-red-700"
              >
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
                <WashuFaqLinks links={f.links} />
              </div>
            ))}
          </section>
        ) : null}

        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-red-600 to-rose-700 px-8 py-12 text-center mb-10">
          <div className="absolute -top-16 -right-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <h2 className="relative text-3xl md:text-4xl font-black text-white mb-3">
            Your perfect WashU housing, found for you.
          </h2>
          <p className="relative text-red-50 mb-7 max-w-xl mx-auto leading-relaxed">
            Answer a few quick questions and our housing agent finds the
            apartment that fits you best, completely free.
          </p>
          <Link
            href="/matchmaking"
            className="relative inline-flex items-center justify-center rounded-xl bg-white px-7 py-3.5 font-bold text-red-600 hover:bg-red-50 transition shadow-lg"
          >
            Find my apartment
          </Link>
        </section>

        {(content.sources?.length || content.benchmarkNote) && (
          <div className="max-w-3xl border-t border-gray-100 pt-5">
            {content.sources?.length ? (
              <p className="text-sm text-gray-600 mb-2">
                <span className="font-semibold">Sources: </span>
                {content.sources.map((s, i) => (
                  <span key={s.url}>
                    {i > 0 ? " · " : ""}
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-red-600 underline decoration-red-200 underline-offset-2 hover:decoration-red-600"
                    >
                      {s.label}
                    </a>
                  </span>
                ))}
              </p>
            ) : null}
            {content.benchmarkNote ? (
              <p className="text-xs text-gray-400">{content.benchmarkNote}</p>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
