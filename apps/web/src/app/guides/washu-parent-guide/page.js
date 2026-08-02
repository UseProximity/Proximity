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
  title: "WashU Off-Campus Housing: A Parent's Guide",
  description:
    "Thinking about off-campus housing near WashU? Compare dorms and apartments, understand costs, and learn what every family should know before signing a lease.",
};

const currentGuideSlug = "washu-parent-guide";
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
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">
                  {currentGuide.category}
                </span>
                <span className="flex items-center gap-1 text-sm text-gray-500">
                  <Clock3 size={14} /> {currentGuide.readTime}
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-gray-600 sm:mt-4 sm:text-base sm:leading-7">
                A parent&apos;s guide to WashU housing: on-campus dorms,
                off-campus apartments near WashU, and what every family should
                know before their student signs.
              </p>

              <h1 className="mt-4 text-3xl font-black tracking-tight text-gray-950 sm:mt-6 sm:text-4xl lg:text-5xl xl:text-6xl">
                Your student is about to choose their first apartment.
                Here&apos;s what you need to know.
              </h1>

              <div className="mt-6 flex items-center gap-3 sm:mt-8">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 sm:h-11 sm:w-11">
                  <Home size={18} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    By {currentGuide.author}
                  </p>
                </div>
              </div>
            </div>

            {/* Right: image card */}
            <div className="relative">
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg sm:rounded-[2rem] sm:shadow-xl">
                <div className="relative aspect-[4/3]">
                  <Image
                    src={currentGuide.image}
                    alt="WashU off-campus housing parent guide"
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
                    Junior year is when WashU housing decisions get real, and
                    most students sign leases without ever hearing from someone
                    who&apos;s lived in the building. Here&apos;s what parents
                    need to know about the on-campus to off-campus transition,
                    the four types of off-campus housing near WashU, and what
                    every family should know before their student signs a lease.
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
          <article className="min-w-0">
            <div className="space-y-8 text-gray-800 sm:space-y-10">
              <p className="text-base leading-7 sm:text-lg sm:leading-8">
                <strong>
                  Junior year is the moment many WashU parents didn&apos;t see
                  coming.
                </strong>{" "}
                Your student has likely lived on campus for two years, and now
                suddenly they&apos;re texting you about leases and landlords. It
                can move fast. Here&apos;s what nobody tells you upfront: you
                have more time than it feels like, and with the right
                information, the process doesn&apos;t have to be as hard as it
                feels.
              </p>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Years 1 and 2: On-campus is required
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>
                    WashU now requires freshmen and sophomores to live on
                    campus.
                  </strong>{" "}
                  For incoming first-years, students rank housing preferences
                  across six types: modern or traditional, and single, double,
                  or triple. Modern dorms tend to be newer builds with
                  suite-style bathrooms. Traditional halls have the classic
                  corridor layout with communal bathrooms. Neither is better —
                  it depends entirely on your student&apos;s personality.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>Rising sophomores</strong> rank the same preferences,
                  with one extra choice: South 40 or the Village (WashU&apos;s
                  primary housing area for sophomores and juniors).
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  If your student wants{" "}
                  <strong>real opinions before they rank</strong>,{" "}
                  <Link
                    href="/"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    Proximity&apos;s
                  </Link>{" "}
                  on-campus hub lets them filter by room type and read verified
                  reviews from students who&apos;ve actually lived in those
                  specific dorms. Find it at{" "}
                  <Link
                    href="/CampusHub"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/CampusHub
                  </Link>
                  .
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Junior year: when the decision gets real
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>
                    Sophomores rank preferences for specific dorms for junior
                    year.
                  </strong>{" "}
                  But with WashU enrollment at its second-highest point in
                  school history, more juniors are getting pushed out of their
                  first choice spots in the Village. Many are choosing to go
                  off-campus. And the finances often make a compelling case.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>
                    WashU charges up to $19,500 per year for on-campus housing
                  </strong>
                  , a number that has jumped 15% in just three years. Off-campus
                  students consistently report paying $800 to $1,000 per month,
                  which works out to $9,600 to $12,000 annually.{" "}
                  <strong>The gap can be $7,000 or more per year.</strong>
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  The four types of off-campus housing near WashU
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>Not all off-campus housing is the same.</strong>{" "}
                  Here&apos;s how it breaks down:
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Units by the loop are smaller buildings on streets like
                  Washington, Kingsbury, and Waterman.{" "}
                  <strong>
                    Walkable, social, close to restaurants and other students.
                  </strong>{" "}
                  They feel like a real home. The buildings are older, so
                  landlord quality varies. Peer reviews matter most here.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Purpose-built Delmar Loop apartments are{" "}
                  <strong>usually furnished, often with amenities</strong> like
                  gyms, study rooms, pools, and rooftop decks. Most have
                  per-bedroom leasing. This is typically the most expensive
                  option.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Neighborhood complexes are managed properties in areas like
                  the Central West End and Clayton.{" "}
                  <strong>
                    Often the nicest apartments, with in-unit laundry and
                    stronger management.
                  </strong>{" "}
                  They&apos;re farther from campus and the social scene, so
                  transportation matters. Students without cars will want to
                  confirm shuttle access before signing.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Scattered houses are independent rentals on quieter
                  residential streets. Yards, porches, brick, real character.{" "}
                  <strong>The most space for the price.</strong> Landlord
                  vetting is especially important here, in addition to
                  transportation.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  The part most students skip
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Here&apos;s what the housing search actually looks like for
                  most WashU students.{" "}
                  <strong>
                    Zillow, Apartments.com, WashU ARS, a private landlord site,
                    Facebook groups, some word of mouth
                  </strong>
                  , and then a lease signed without ever hearing from anyone
                  who&apos;s actually lived in that apartment. We surveyed 500+
                  WashU students on how they find housing, and no single
                  platform or method came close to being dominant.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  That gap — between finding a listing and knowing what
                  you&apos;re signing into — is what Proximity was built to
                  close. <strong>Verified student reviews</strong> of WashU
                  dorms and off-campus apartments,{" "}
                  <strong>pre-vetted listings</strong> tailored to WashU
                  students,{" "}
                  <strong>and a free personalized housing match</strong> for
                  students who want help narrowing it down.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Better apartments. Honest reviews. No guesswork.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Get the free housing match at{" "}
                  <Link
                    href="/matchmaking"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/matchmaking
                  </Link>
                  , or browse verified reviews at{" "}
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

            {/* ── Related guides — mobile only ── */}
            <RelatedArticlesMobile relatedGuides={relatedGuides} />

            <GuideCTA />
          </article>

          <RelatedArticlesSidebar relatedGuides={relatedGuides} />
        </div>
      </div>
      <ScrollToTop />
    </main>
  );
}
