import Link from "next/link";
import { notFound } from "next/navigation";
import { washuPages, getWashuPage } from "@/lib/washuPages";
import { washuContent } from "@/content/washu";
import {
  getWashuPageListings,
  walkMinutesRange,
} from "@/lib/listings/queryListings";
import WashuListingGrid from "@/components/washu/WashuListingGrid";
import WashuPageJsonLd from "@/components/washu/WashuPageJsonLd";

// Only registry slugs exist; anything else 404s so there is no crawlable
// junk space of invented facet URLs.
export const dynamicParams = false;
export const revalidate = 3600;

export function generateStaticParams() {
  return washuPages.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const page = getWashuPage(slug);
  if (!page) return {};
  const { meetsThreshold } = await getWashuPageListings(page);
  return {
    title: page.title,
    description: page.metaDescription,
    alternates: { canonical: `/washu/${page.slug}` },
    // Thin pages stay useful and linked but out of the index until inventory
    // supports them (same gate excludes them from the sitemap).
    ...(meetsThreshold ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      title: page.title,
      description: page.metaDescription,
      url: `/washu/${page.slug}`,
    },
  };
}

export default async function WashuLandingPage({ params }) {
  const { slug } = await params;
  const page = getWashuPage(slug);
  const content = washuContent[slug];
  if (!page || !content) notFound();

  const { listings, count, meetsThreshold } = await getWashuPageListings(page);
  const walk = walkMinutesRange(listings);
  const related = (page.related ?? [])
    .map((s) => getWashuPage(s))
    .filter(Boolean);

  return (
    <main className="min-h-screen bg-white text-gray-900">
      {meetsThreshold ? (
        <WashuPageJsonLd page={page} content={content} listings={listings} />
      ) : null}

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-gray-500">
          <Link href="/" className="hover:text-gray-900">
            Home
          </Link>
          <span className="mx-2">/</span>
          <Link href="/washu" className="hover:text-gray-900">
            WashU Off-Campus Housing
          </Link>
          <span className="mx-2">/</span>
          <span className="text-gray-900">{page.h1}</span>
        </nav>

        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-5">
          {page.h1}
        </h1>

        {/* AEO direct answer: first element after the H1, plain paragraph */}
        <p className="text-lg text-gray-800 leading-relaxed max-w-3xl mb-4 font-medium">
          {content.directAnswer}
        </p>

        {walk ? (
          <p className="text-sm text-gray-600 mb-8">
            {count === 1
              ? "The listing below is"
              : `These ${count} listings are`}{" "}
            a {walk.min === walk.max ? walk.min : `${walk.min} to ${walk.max}`}{" "}
            minute walk to campus.
          </p>
        ) : (
          <div className="mb-8" />
        )}

        {/* Live inventory */}
        <section className="mb-12">
          <WashuListingGrid listings={listings} />
        </section>

        {/* Editorial intro */}
        <section className="max-w-3xl mb-12">
          {content.intro.map((paragraph, i) => (
            <p key={i} className="text-gray-700 leading-relaxed mb-4">
              {paragraph}
            </p>
          ))}
        </section>

        {/* FAQ: plain headings and paragraphs, no accordion, for extractability */}
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

        {/* Related pages */}
        {related.length ? (
          <section className="max-w-3xl mb-12">
            <h2 className="text-2xl font-bold mb-4">Keep looking</h2>
            <ul className="space-y-2">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/washu/${r.slug}`}
                    className="text-red-600 font-medium hover:text-red-700"
                  >
                    {r.h1}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/guides"
                  className="text-red-600 font-medium hover:text-red-700"
                >
                  WashU housing guides
                </Link>
              </li>
            </ul>
          </section>
        ) : null}

        {/* CTA */}
        <section className="rounded-2xl bg-gray-900 px-8 py-10 text-center mb-10">
          <h2 className="text-3xl font-black text-white mb-3">
            Tell us your budget. We find the fits.
          </h2>
          <p className="text-gray-300 mb-6 max-w-xl mx-auto">
            Free matchmaking from students who know every building on this
            page. No spam, no broker fees, no stress.
          </p>
          <Link
            href="/matchmaking"
            className="inline-flex items-center justify-center rounded-xl bg-red-600 px-6 py-3 font-semibold text-white hover:bg-red-700 transition"
          >
            Get matched free
          </Link>
        </section>

        {/* Benchmark provenance */}
        {content.benchmarkNote ? (
          <p className="text-xs text-gray-400 max-w-3xl">
            {content.benchmarkNote}
          </p>
        ) : null}
      </div>
    </main>
  );
}
