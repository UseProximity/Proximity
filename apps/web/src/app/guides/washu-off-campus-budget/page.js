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
  title: "How Much Should I Budget for Off-Campus Rent Near WashU?",
  description:
    "WashU on-campus housing now runs up to $19,500/year. Here's what off-campus rent near WashU actually costs, by neighborhood and roommate count.",
};

const currentGuideSlug = "washu-off-campus-budget";
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
                A clear breakdown of what off-campus rent near WashU actually
                costs, including roommate count, neighborhoods, utilities,
                furniture, and lease length.
              </p>

              <h1 className="mt-4 text-3xl font-black tracking-tight text-gray-950 sm:mt-6 sm:text-4xl lg:text-5xl xl:text-6xl">
                How Much Should I Budget for Off-Campus Rent Near WashU?
              </h1>

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

            {/* Right: image card */}
            <div className="relative">
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg sm:rounded-[2rem] sm:shadow-xl">
                <div className="relative aspect-[4/3]">
                  <Image
                    src={currentGuide.image}
                    alt="Off-campus rent near WashU"
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
                    This guide gives students a real reference point before they
                    start touring apartments. It explains how rent changes by
                    roommate count, neighborhood, and whether utilities or
                    furniture are included.
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
              {/* Key Takeaways */}
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:rounded-3xl sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 sm:text-sm">
                  Key Takeaways
                </p>
                <ul className="mt-3 space-y-2.5 sm:mt-4 sm:space-y-3">
                  {[
                    "Living off-campus is significantly cheaper than staying on campus.",
                    "Most students pay $700 to $1,100 per person per month for off-campus housing, depending on roommates and location.",
                    "Roommate count is the biggest lever. Going from solo to a three-person split can roughly halve your monthly rent.",
                    "Always compare all-in cost. Utilities can swing your real monthly number significantly.",
                    "The best units near WashU get claimed by spring. Start looking as early as possible.",
                  ].map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                      <span className="text-sm leading-6 text-gray-800 sm:text-lg sm:leading-8">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <p className="text-base leading-7 sm:text-lg sm:leading-8">
                WashU charges up to $19,500 per year for on-campus housing, up
                15% in just three years. Off-campus students consistently pay
                $9,600 to $12,000 annually. The gap can be $7,000 or more per
                year, and many upperclassmen undergrads don&apos;t realize this.
              </p>

              <p className="text-base leading-7 sm:text-lg sm:leading-8">
                Most students start the search with no reference point. They
                anchor on whatever their friends paid or the first few listings
                they opened. This gives you the lay of the land before you start
                looking, specific to the St. Louis market.
              </p>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  What&apos;s Normal for Off-Campus Rent Near WashU
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Most WashU students living off-campus land somewhere in the
                  $700 to $1,100 per person per month range. It comes down to
                  three things: how many roommates you have, how new the
                  building is, and how close you are to campus and the Delmar
                  Loop.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Solo living is the most expensive by a wide margin. A studio
                  or one-bedroom in an older building might start around $900 a
                  month for the whole unit on a full-year lease. In a new,
                  full-amenity building on or near Delmar, that solo situation
                  can be $2,000+ a month. Splitting with roommates is where the
                  real savings are.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  How Roommates Change Everything
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  The single most powerful budgeting lever you have isn&apos;t
                  the neighborhood you pick or the amenities you give up.
                  It&apos;s how many people you live with.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Here&apos;s what the math looks like:
                </p>
                <ul className="space-y-3">
                  {[
                    {
                      label: "Solo (studio or 1BR):",
                      text: "Depending on the building and location, rent typically runs somewhere between $900 and $2,000+ a month, with no one to split the rent with.",
                    },
                    {
                      label: "Two people (2BR):",
                      text: "Splitting a two-bedroom typically brings each person into the $700 to $900 range per month.",
                    },
                    {
                      label: "Three people (3BR):",
                      text: "Often the sweet spot. Groups of three frequently land in the $500 to $800 per person range, and three-bedrooms near WashU are common enough that you have real options at this size.",
                    },
                  ].map(({ label, text }) => (
                    <li key={label} className="flex gap-3">
                      <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                      <span className="text-base leading-7 sm:text-lg sm:leading-8">
                        <strong>{label}</strong> {text}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Going from living solo to splitting a three-bedroom can
                  roughly cut your monthly rent close to in half. Over a year,
                  that&apos;s thousands of dollars per person.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  What Rent Looks Like by Neighborhood
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  The type of building you choose matters as much as the
                  neighborhood. If you&apos;re not sure which fits your
                  situation, we break down{" "}
                  <Link
                    href="/guides/four-types-washu-housing"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    all four types of WashU off-campus housing
                  </Link>{" "}
                  in a separate guide.
                </p>

                {[
                  {
                    title: "The Delmar Loop and University City",
                    body: "The largest share of off-campus WashU students live here. Loop units are typically a 15 to 25 minute walk to campus. It's walkable to restaurants, coffee, bars, and shuttle stops. Good units go fast and the best prices get claimed early in the year. The budget spread is wide — older walk-ups can offer solid per-person value while new amenity buildings can run well past $1,200 per person.",
                  },
                  {
                    title: "Skinker-DeBaliviere",
                    body: "Just south of the Loop. Often the best per-person value for quality units close to campus. Typically a 15 to 25 minute walk, good shuttle access, and full of solid older brick buildings and renovated flats. For groups looking to stretch their budget without sacrificing location, this is consistently one of the stronger areas near WashU.",
                  },
                  {
                    title: "Central West End",
                    body: "East of campus, across Forest Park. A walkable neighborhood with a strong restaurant scene. However, it's not walkable to the Danforth campus — students here lean on the WashU shuttle, MetroLink, or their car. If you're commuting to the medical school, this is where to look first.",
                  },
                  {
                    title: "Clayton",
                    body: "Southeast of campus. Upscale and quiet, with very few undergrads. The farthest from the Loop social scene, and widely considered the safest area. Clayton is the most expensive area around WashU — rents run well above the broader St. Louis market. It makes sense for students who prioritize quiet and a polished neighborhood over proximity to campus.",
                  },
                ].map(({ title, body }) => (
                  <div key={title}>
                    <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                      {title}
                    </h3>
                    <p className="mt-2 text-base leading-7 sm:text-lg sm:leading-8">
                      {body}
                    </p>
                  </div>
                ))}
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Furnished vs. Unfurnished: The Price Gap Near the Loop
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Near the Delmar Loop, whether a unit comes furnished is one of
                  the biggest pricing variables students overlook. Fully
                  furnished buildings can run significantly more per month than
                  comparable unfurnished units nearby.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  There are three ways to approach it:
                </p>
                {[
                  {
                    label: "Pay the premium for a furnished unit.",
                    text: "Some buildings near the Loop bundle furniture, utilities, and amenities into one monthly price. Convenient, but you're paying for that convenience for the entire lease, whether you need it or not.",
                  },
                  {
                    label: "Rent furniture for an unfurnished listing.",
                    text: 'On any unfurnished listing on Proximity, there\'s a "Furnish This Property" button. It connects you to student furniture bundles for $139 or $169 a month, so your place is move-in ready on day one.',
                  },
                  {
                    label: "Buy furniture from the previous tenant.",
                    text: "Previous tenants frequently discard or sell furniture at move-out. Ask your landlord to put you in touch with the outgoing tenant before they leave. If the landlord pushes back, take that as a signal about how they handle landlord-tenant communication generally.",
                  },
                ].map(({ label, text }) => (
                  <p
                    key={label}
                    className="text-base leading-7 sm:text-lg sm:leading-8"
                  >
                    <strong>{label}</strong> {text}
                  </p>
                ))}
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  The Hidden Cost: What &quot;Utilities Included&quot; Actually
                  Means
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Listings near WashU vary wildly on utilities. Some include
                  everything: heat, electric, gas, water, sewer, trash, and
                  internet. Some include nothing. That difference can swing your
                  true monthly cost by hundreds of dollars.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Before you sign anything, ask:
                </p>
                <ul className="space-y-3">
                  {[
                    "Which utilities are included in the rent?",
                    "Who pays gas, electric, and internet?",
                    "Is internet already set up in the building, or do you have to arrange your own provider?",
                  ].map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                      <span className="text-base leading-7 sm:text-lg sm:leading-8">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Always compare the all-in monthly cost, not just the rent
                  number on the listing. A slightly higher rent with everything
                  included often beats a lower rent where you&apos;re separately
                  covering heat through a St. Louis winter.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Lease Length: What You Actually Need to Know
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Most landlords near WashU default to 12-month leases. The
                  complication comes when your timeline doesn&apos;t fit:
                  studying abroad for a semester, arriving in January, or
                  leaving in May when your lease runs through August.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>
                    Semester and shorter leases exist, but they cost more.
                  </strong>{" "}
                  Across university housing markets, semester leases typically
                  run 10 to 25 percent more per month than 12-month leases. That
                  premium shows up in the St. Louis market too.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>
                    If you sign a 12-month lease and need to leave after one
                    semester, subletting is the most common solution.
                  </strong>{" "}
                  Spring subleases are significantly harder to fill. Some leases
                  also restrict subletting entirely, so make sure to find out
                  before planning around that option.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  If you need to list your unit for sublet, you can do it for
                  free on Proximity at{" "}
                  <Link
                    href="/add-sublease"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/add-sublease
                  </Link>
                  .
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Skip the Guesswork
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Proximity gives WashU students verified peer reviews of actual
                  buildings and landlords, honest pricing context from real
                  listings, and a free personalized match based on their actual
                  budget, group size, commute preference, and lease term.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Get a free housing match at{" "}
                  <Link
                    href="/matchmaking"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/matchmaking
                  </Link>{" "}
                  or browse verified WashU listings at{" "}
                  <Link
                    href="/browse"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/browse
                  </Link>
                  .
                </p>
              </section>

              {/* FAQ */}
              <section className="space-y-6 border-t border-gray-200 pt-6 sm:pt-8">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  FAQ: WashU Off-Campus Rent, Quick Answers
                </h2>
                <div className="space-y-6">
                  {[
                    {
                      q: "How much is rent near WashU per month?",
                      a: "Most students land somewhere in the $700 to $1,100 per person range, depending on roommates, building type, and location. Solo living runs higher, often between $900 and $2,000-plus a month for the whole unit.",
                    },
                    {
                      q: "Is off-campus housing cheaper than the WashU dorms?",
                      a: "Yes, usually by a meaningful amount. WashU's on-campus housing runs up to $19,500 per year, while off-campus students consistently pay $9,600 to $12,000 annually. That gap can be $7,000 or more per year.",
                    },
                    {
                      q: "What's the cheapest way to live near WashU?",
                      a: "More roommates in an older building a few blocks off the Loop. Skinker-DeBaliviere tends to offer the best per-person value. Groups of three or four have the most options at the lower end of the market.",
                    },
                    {
                      q: "Do I need a guarantor or co-signer?",
                      a: "Many WashU-area landlords require one for students without income or established credit history. Requirements vary by landlord, so ask each one directly before you get too far into the process.",
                    },
                    {
                      q: "When should I start looking?",
                      a: "January through March is peak season near WashU. The best-value units are typically claimed by spring. Starting early gives you more options and more time to make a considered decision.",
                    },
                  ].map(({ q, a }) => (
                    <section key={q} className="space-y-2">
                      <h3 className="text-lg font-bold tracking-tight text-gray-950 sm:text-2xl">
                        {q}
                      </h3>
                      <p className="text-base leading-7 sm:text-lg sm:leading-8">
                        {a}
                      </p>
                    </section>
                  ))}
                </div>
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
