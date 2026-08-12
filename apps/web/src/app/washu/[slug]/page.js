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

      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-gray-100 bg-gradient-to-br from-rose-50 via-white to-gray-50">
        <div className="absolute -top-24 right-[-6rem] h-96 w-96 rounded-full bg-rose-200/40 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 pt-8 pb-10 sm:px-6 sm:pt-10 sm:pb-12">
          <nav className="mb-5 text-sm text-gray-500">
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

          <span className="inline-block rounded-full bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-red-600 mb-4">
            WashU Housing
          </span>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-6">
            {page.h1}
          </h1>

          {/* AEO direct answer: first content element, visually a callout */}
          <div className="max-w-3xl rounded-2xl border border-gray-100 border-l-4 border-l-red-600 bg-white p-5 shadow-sm">
            <p className="text-lg text-gray-800 leading-relaxed font-medium">
              {content.directAnswer}
            </p>
          </div>

          {walk ? (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white border border-gray-200 px-4 py-1.5 text-sm text-gray-700 shadow-sm">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4 text-red-600"
              >
                <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7" />
              </svg>
              {count === 1 ? "1 listing" : `${count} listings`},{" "}
              {walk.min === walk.max ? walk.min : `${walk.min} to ${walk.max}`}{" "}
              minute walk to campus
            </div>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* Live inventory (answer pages are content-led and skip the grid) */}
        {page.filter ? (
          <section className="mb-14">
            <span className="inline-block rounded-full bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-red-600 mb-3">
              Available Now
            </span>
            <h2 className="text-2xl md:text-3xl font-black mb-6">
              Live listings, real reviews.
            </h2>
            <WashuListingGrid listings={listings} />
          </section>
        ) : null}

        {/* Editorial intro */}
        <section className="max-w-3xl mb-14">
          {content.intro.map((paragraph, i) => (
            <p
              key={i}
              className="text-[17px] text-gray-700 leading-relaxed mb-5"
            >
              {paragraph}
            </p>
          ))}
        </section>

        {/* FAQ: plain headings and paragraphs, no accordion, for extractability */}
        {content.faqs?.length ? (
          <section className="max-w-3xl mb-14">
            <span className="inline-block rounded-full bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-red-600 mb-3">
              Real Questions
            </span>
            <h2 className="text-2xl md:text-3xl font-black mb-6">
              What students actually ask
            </h2>
            <div className="space-y-4">
              {content.faqs.map((f, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-gray-100 bg-gray-50/60 p-5 hover:border-rose-200 transition-colors"
                >
                  <h3 className="text-lg font-bold mb-2">{f.q}</h3>
                  <p className="text-gray-700 leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Related pages */}
        {related.length ? (
          <section className="max-w-3xl mb-14">
            <h2 className="text-xl font-black mb-4">Keep looking</h2>
            <div className="flex flex-wrap gap-2.5">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/washu/${r.slug}`}
                  className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-red-300 hover:text-red-600 transition-colors"
                >
                  {r.h1}
                </Link>
              ))}
              <Link
                href="/guides"
                className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-red-300 hover:text-red-600 transition-colors"
              >
                Housing guides
              </Link>
            </div>
          </section>
        ) : null}

        {/* CTA */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-red-600 to-rose-700 px-8 py-12 text-center mb-10">
          <div className="absolute -top-16 -right-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <h2 className="relative text-3xl md:text-4xl font-black text-white mb-3">
            Your perfect WashU housing, found for you.
          </h2>
          <p className="relative text-red-50 mb-7 max-w-xl mx-auto leading-relaxed">
            Share your budget and preferences, answer a few quick questions,
            and matchmaking pairs you with places that actually fit. Free, no
            spam, no broker fees.
          </p>
          <Link
            href="/matchmaking"
            className="relative inline-flex items-center justify-center rounded-xl bg-white px-7 py-3.5 font-bold text-red-600 hover:bg-red-50 transition shadow-lg"
          >
            Get matched free
          </Link>
        </section>

        {/* Sources + provenance */}
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
