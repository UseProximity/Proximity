import Link from "next/link";
import Image from "next/image";
import { Clock3, Home } from "lucide-react";
import { guides } from "@/lib/guides";
import GuideJsonLd from "@/components/guides/GuideJsonLd";
import GuideCTA from "@/components/guides/GuideCTA";
import RelatedArticlesSidebar from "@/components/guides/RelatedArticlesSidebar";
import BackNav from "@/components/guides/BackNav";
import RelatedArticlesMobile from "@/components/guides/RelatedArticlesMobile";
import ScrollToTop from "@/components/guides/ScrollToTop";

export const metadata = {
  title: "WashU Apartment Checklist: Questions Before Signing",
  description:
    "A parent's checklist for the WashU off-campus housing search. Questions to ask landlords, current tenants, and yourself before signing a lease.",
};

const currentGuideSlug = "washu-apartment-checklist";
const currentGuide = guides.find((guide) => guide.slug === currentGuideSlug);
const relatedGuides = guides.filter((guide) => guide.slug !== currentGuideSlug);

export default function Page() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <GuideJsonLd slug={currentGuideSlug} />
      <BackNav />

      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-gray-200 bg-gradient-to-br from-rose-50 via-white to-gray-50">
        <div className="absolute -top-24 right-[-6rem] h-96 w-96 rounded-full bg-rose-200/40 blur-3xl" />
        <div className="absolute bottom-[-5rem] left-[-4rem] h-80 w-80 rounded-full bg-orange-100/60 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:py-14">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-10">
            {/* Left: text */}
            <div>
              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">
                  {currentGuide.category}
                </span>
                <span className="flex items-center gap-1 text-sm text-gray-500">
                  <Clock3 size={14} /> {currentGuide.readTime}
                </span>
                <span className="text-sm text-gray-500">
                  Updated Jun 22, 2026
                </span>
              </div>

              {/* Description — tightened on mobile */}
              <p className="mt-3 text-sm leading-6 text-gray-600 sm:mt-4 sm:text-base sm:leading-7">
                Before your WashU student signs an apartment lease, they should
                be able to answer these questions. A parent&apos;s checklist for
                the off-campus housing search.
              </p>

              {/* H1 — smaller on mobile */}
              <h1 className="mt-4 text-3xl font-black tracking-tight text-gray-950 sm:mt-6 sm:text-4xl lg:text-5xl xl:text-6xl">
                Before your student signs a lease, make sure they can answer
                these questions.
              </h1>

              {/* Author */}
              <div className="mt-6 flex items-center gap-3 sm:mt-8">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 sm:h-11 sm:w-11">
                  <Home size={18} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    By {currentGuide.author}
                  </p>
                  <p className="text-xs text-gray-500 sm:text-sm">
                    Written for WashU students and families
                  </p>
                </div>
              </div>
            </div>

            {/* Right: image card — full width on mobile, grid column on desktop */}
            <div className="relative">
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg sm:rounded-[2rem] sm:shadow-xl">
                <div className="relative aspect-[4/3]">
                  <Image
                    src={currentGuide.image}
                    alt="Apartment checklist"
                    fill
                    priority
                    className="object-cover"
                  />
                </div>
                <div className="border-t border-gray-200 p-4 sm:p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500 sm:text-sm">
                    Summary
                  </p>
                  <p className="mt-2 text-sm leading-6 text-gray-600 sm:mt-3 sm:text-base sm:leading-7">
                    {currentGuide.summary}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Body ── */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Article */}
          <article className="min-w-0">
            <div className="space-y-8 text-gray-800 sm:space-y-10">
              <p className="text-base leading-7 sm:text-lg sm:leading-8">
                <strong>
                  Here&apos;s a pattern that plays out every spring at WashU.
                </strong>{" "}
                A junior finds an apartment, loves it, signs the lease, and
                moves in before anyone has thought to ask even the most basic
                questions about the building, the landlord, or the neighborhood.
                It&apos;s not carelessness — it&apos;s just that nobody handed
                them a checklist. Consider this yours.
              </p>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Where your student is in the housing timeline
                </h2>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>
                    WashU now requires freshmen and sophomores to live on campus
                  </strong>
                  , so for underclassmen, the question is which dorm, not which
                  apartment. First-years rank preferences across six room types:
                  modern or traditional, and single, double, or triple. Modern
                  dorms are newer builds with suite-style bathrooms. Traditional
                  halls have the classic corridor layout with communal
                  bathrooms. Neither is better — it depends on your
                  student&apos;s personality and sleep schedule.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>Rising sophomores</strong> rank the same preferences,
                  with one extra choice: South 40 or the Village (WashU&apos;s
                  primary housing area for sophomores and juniors).
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <a
                    href="https://useproximity.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    Proximity
                  </a>
                  &apos;s campus hub has verified student reviews filtered by
                  room type — actual opinions from students who&apos;ve lived
                  there. Find it at{" "}
                  <a
                    href="https://useproximity.org/CampusHub"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/CampusHub
                  </a>
                  .
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>Junior year is when it gets more complicated.</strong>{" "}
                  WashU charges up to $19,500 per year for on-campus housing, up
                  15% in just three years. Off-campus students consistently pay
                  $9,600 to $12,000 annually.{" "}
                  <strong>The gap can be $7,000 or more per year.</strong>
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>
                    Off-campus housing near WashU falls into four categories.
                  </strong>{" "}
                  Units by Delmar Loop are small and walkable. Loop complexes
                  are purpose-built apartments with amenities like pools and
                  gyms. Neighborhood complexes in areas like the Central West
                  End or Clayton have the nicest finishes but are farther out.
                  Scattered houses offer the most space and character.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>
                    The financial case for going off-campus is strong.
                  </strong>{" "}
                  But the savings only hold if your student signs a good lease,
                  in a well-managed building, with a landlord who actually shows
                  up when something goes wrong.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  The checklist
                </h2>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  We surveyed 500+ WashU students on how they find housing. Most
                  sign a lease without ever hearing from someone who&apos;s
                  actually lived in the building. Before your student does, make
                  sure they can answer these.
                </p>

                <p className="text-sm italic leading-6 text-gray-600 sm:text-base sm:leading-7">
                  Have your student screenshot this or save it on their phone
                  before their next apartment showing.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Questions for the landlord
                </h2>

                <ul className="space-y-3">
                  {[
                    "Who handles maintenance requests, and what's the typical response time?",
                    "What's the policy if something breaks?",
                    "Is the landlord local, or is this managed by a property company?",
                    "Which utilities are included, and which aren't?",
                    "What does the lease say about subleasing? (if applicable)",
                    "How much is the security deposit, and what's the typical return amount?",
                    "Is a guarantor or co-signer required, and who qualifies?",
                    "What's the building's entry and security setup?",
                  ].map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                      <span className="text-base leading-7 sm:text-lg sm:leading-8">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Questions for anyone who&apos;s lived there
                </h2>

                <ul className="space-y-3">
                  {[
                    "How was the landlord when something actually went wrong?",
                    "Is the neighborhood safe?",
                    "Were there noise, pest, or building issues that weren't mentioned upfront?",
                    "How ready was the apartment on move-in day?",
                    "Would they live there again?",
                  ].map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                      <span className="text-base leading-7 sm:text-lg sm:leading-8">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-4 border-t border-gray-200 pt-6 sm:pt-8">
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>
                    Hearing from someone who&apos;s actually lived there is the
                    hardest thing to get in a standard apartment search.
                  </strong>{" "}
                  It&apos;s exactly what Proximity&apos;s verified student
                  reviews of apartments near WashU are built for. WashU-specific
                  listings, honest peer reviews of dorms and off-campus
                  apartments, and a free personalized housing match for students
                  who want help narrowing it down.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Get a free housing match at{" "}
                  <Link
                    href="/matchmaking"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/matchmaking
                  </Link>
                  , or browse verified WashU listings and reviews at{" "}
                  <Link
                    href="/"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org
                  </Link>
                  .
                </p>
              </section>
            </div>

            {/* ── Related guides — visible on mobile only (replaces aside) ── */}
            <RelatedArticlesMobile relatedGuides={relatedGuides} />

            <GuideCTA />
          </article>

          {/* ── Sidebar — desktop only ── */}
          <RelatedArticlesSidebar relatedGuides={relatedGuides} />
        </div>
      </div>
      <ScrollToTop />
    </main>
  );
}
