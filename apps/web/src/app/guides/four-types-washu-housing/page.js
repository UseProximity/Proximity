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
  title:
    "The 4 Types of Off-Campus Housing Near WashU (and Which Is Right for You)",
  description:
    "Not all off-campus housing near WashU is the same. This guide breaks down the four types so you can skip the scroll and find the right fit for how you want to live.",
};

const currentGuideSlug = "four-types-washu-housing";
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
                Students searching for off-campus housing near WashU run into
                the same problem early: they&apos;re comparing apartments that
                aren&apos;t even in the same ballpark.
              </p>

              <h1 className="mt-4 text-3xl font-black tracking-tight text-gray-950 sm:mt-6 sm:text-4xl lg:text-5xl xl:text-6xl">
                The 4 Types of Off-Campus Housing Near WashU (and Which Is Right
                for You)
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
                    alt="Off-campus housing near WashU"
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
                    Off-campus housing near WashU comes down to four distinct
                    types: Loop Units, Loop Complexes, Neighborhood Complexes,
                    and Scattered Units.
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
                A two-bedroom in a duplex near the Loop and a fully furnished
                complex with a gym on Delmar are both &quot;apartments near
                WashU,&quot; but the price range, lifestyle, and trade-offs are
                vastly different.
              </p>

              <p className="text-base leading-7 sm:text-lg sm:leading-8">
                Off-campus housing near WashU comes down to four distinct types:
                Loop Units, Loop Complexes, Neighborhood Complexes, and
                Scattered Units. Once you know which type you&apos;re looking
                for, the search gets way simpler.
              </p>

              {/* Key Takeaways */}
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:rounded-3xl sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 sm:text-sm">
                  Key Takeaways
                </p>
                <ul className="mt-3 space-y-2.5 sm:mt-4 sm:space-y-3">
                  {[
                    "The four types are not comparable to each other. Comparing a loop unit to a loop complex is like comparing a walk-up in Brooklyn to a doorman building.",
                    "Loop complexes are the most expensive category.",
                    "Furnished options and unfurnished options have a large price gap, especially by the Loop. Renting or purchasing your own furniture is often more cost-efficient.",
                    "In every category, the landlord matters as much as the building. Peer reviews from actual tenants are the highest-leverage thing you can check before signing.",
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

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  A Quick Map of the Four Types
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Loop units are walkable, older, and rooted in real
                  neighborhood character. Loop complexes are furnished,
                  amenity-heavy buildings right on Delmar. Neighborhood
                  complexes are modern, managed buildings a bit further from the
                  action. Scattered units are individual apartments and houses
                  spread across WashU-adjacent neighborhoods — the most space
                  and character for the money.
                </p>
              </section>

              {/* Type 1 */}
              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Type 1: Loop Units
                </h2>
                <p className="text-base font-semibold leading-7 text-gray-900 sm:text-lg sm:leading-8">
                  Walkable, with real neighborhood character.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Older apartment buildings and flats on and around the Delmar
                  Loop, on streets like Leland, Westgate, Heman, Interdrive, and
                  Washington in University City. You can walk to campus, walk to
                  the Loop&apos;s restaurants and bars, and walk to Forest Park.
                </p>
                {[
                  {
                    label: "What stands out:",
                    text: "Real character. Hardwood floors, high ceilings, and often a porch or backyard. Landlords here tend to know the student rental market well.",
                  },
                  {
                    label: "Things to consider:",
                    text: "Older buildings mean maintenance responsiveness matters. The Loop gets noisy on weekends. Almost all loop units are unfurnished. Laundry varies by building.",
                  },
                  {
                    label: "Price feel:",
                    text: "Moderate. A 3-bedroom split across three people runs well below the Loop Complex tier.",
                  },
                  {
                    label: "Best for:",
                    text: "Students who want to be in the middle of the social scene, walk everywhere, and are comfortable with a building that has some character and no amenities.",
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

              {/* Type 2 */}
              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Type 2: Loop Complexes
                </h2>
                <p className="text-base font-semibold leading-7 text-gray-900 sm:text-lg sm:leading-8">
                  Furnished, amenity-rich, right in the Loop.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Purpose-built modern buildings on or near the Loop — like
                  LOCAL on Delmar, University Square, and Kingsland Courtyard.
                  Fully furnished and built for student living.
                </p>
                {[
                  {
                    label: "What stands out:",
                    text: "Location right on or adjacent to Delmar. Fully furnished units: beds, couches, desks, appliances all included. Often have study lounges, fitness centers, and community spaces. In-unit laundry is standard.",
                  },
                  {
                    label: "Things to consider:",
                    text: "This is the top of the market. Per-person rates at newer complexes can push toward $2,000/month for a solo setup. Larger buildings mean less privacy.",
                  },
                  {
                    label: "Price feel:",
                    text: "Premium. The most expensive category per person, by a meaningful margin.",
                  },
                  {
                    label: "Best for:",
                    text: "Students who prioritize convenience, security, zero setup, and who like the energy of a bigger building with a built-in community.",
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

              {/* Type 3 */}
              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Type 3: Neighborhood Complexes
                </h2>
                <p className="text-base font-semibold leading-7 text-gray-900 sm:text-lg sm:leading-8">
                  Modern, quiet, well-maintained buildings.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Professionally managed buildings a bit further from the Loop —
                  along Pershing, in the Skinker-DeBaliviere corridor, or across
                  Forest Park in the Central West End. Examples include The
                  Delmonte, Lofts at Euclid, Lofts at Forest Park, Park Lux on
                  Pershing, and Echo apartments on Enright Avenue.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  The CWE properties are far from the Danforth Campus — the
                  shuttle and MetroLink make it workable, but the distance is
                  real. The CWE is much closer to the Medical Campus, so if
                  that&apos;s where you&apos;re commuting, disregard the note
                  above.
                </p>
                {[
                  {
                    label: "What stands out:",
                    text: "Modern finishes and professional management, often at better value per square foot than the Loop complexes. Typically quieter, strong maintenance response.",
                  },
                  {
                    label: "Things to consider:",
                    text: "You will typically need the shuttle, MetroLink, or a short drive to reach Danforth Campus. Furnished options are less consistent here than in the Loop Complex tier.",
                  },
                  {
                    label: "Price feel:",
                    text: "Varies. CWE buildings tend to run on the higher end. Pershing-area and Skinker-corridor options often offer stronger value.",
                  },
                  {
                    label: "Best for:",
                    text: "Students who want a modern, well-run building and are willing to trade walkability for it. Particularly popular with grad and medical students.",
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

              {/* Type 4 */}
              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Type 4: Scattered Units
                </h2>
                <p className="text-base font-semibold leading-7 text-gray-900 sm:text-lg sm:leading-8">
                  The most space for your dollar, private, and versatile.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Individual apartments and houses in smaller buildings spread
                  across WashU-adjacent neighborhoods. Classic St. Louis brick
                  flats, duplexes, and houses on streets like Pershing,
                  McPherson, and Corbitt. The most character and typically the
                  most square footage for the money. Per-person rates in the
                  $500–$800 range appear regularly.
                </p>
                {[
                  {
                    label: "What stands out:",
                    text: "The best per-person value when splitting with roommates. Yards, porches, and actual house character. More privacy than a 100-unit complex.",
                  },
                  {
                    label: "Things to consider:",
                    text: "Landlord quality varies more in this category than any other. Peer reviews from students who have actually lived there are crucial here.",
                  },
                  {
                    label: "Price feel:",
                    text: "Affordable when splitting with roommates.",
                  },
                  {
                    label: "Best for:",
                    text: "Groups who want maximum space and a real home feel, and who are willing to research the landlord carefully.",
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
                  How to Choose the Right Off-Campus Housing Near WashU
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  A few quick questions if you want to self-sort:
                </p>
                <ul className="space-y-3">
                  {[
                    {
                      label: "Walk everywhere and be in the middle of things?",
                      text: "Loop Units or Loop Complexes.",
                    },
                    {
                      label:
                        "Modern, furnished, zero setup, and cost is not the deciding factor?",
                      text: "Loop Complexes.",
                    },
                    {
                      label: "Modern and quiet, fine with the shuttle?",
                      text: "Neighborhood Complexes.",
                    },
                    {
                      label:
                        "Group looking for the most space at the lowest per-person cost?",
                      text: "Scattered Units.",
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
                  Get a free housing match at{" "}
                  <Link
                    href="/matchmaking"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/matchmaking
                  </Link>
                  . Once you know your type, the companion guide breaks down
                  realistic budgets by neighborhood and group size:{" "}
                  <Link
                    href="/guides/washu-off-campus-budget"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    How Much Should I Budget for Off-Campus Rent Near WashU
                  </Link>
                  .
                </p>
              </section>

              <section className="space-y-4 border-t border-gray-200 pt-6 sm:pt-8">
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Knowing the four types turns a disorienting search into a
                  clear one. Proximity is built around exactly this: verified
                  peer reviews of real WashU buildings, honest information on
                  each type, and a free personalized match based on your budget,
                  group size, commute preference, and lease term.
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Get a free housing match:{" "}
                  <Link
                    href="/matchmaking"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/matchmaking
                  </Link>
                </p>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Browse verified WashU listings and peer reviews:{" "}
                  <Link
                    href="/"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org
                  </Link>
                </p>
              </section>

              {/* FAQ */}
              <section className="space-y-6 border-t border-gray-200 pt-6 sm:pt-8">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  FAQ: Quick Answers
                </h2>
                <div className="space-y-6">
                  {[
                    {
                      q: "What is the cheapest type of off-campus housing near WashU?",
                      a: "Scattered Units, when split across a group. Some 3-bedroom flats in the Skinker-DeBaliviere area come in at under $500 per person. Older Loop Units close to the action are also solid value.",
                    },
                    {
                      q: "Which type is best for being close to campus?",
                      a: "Loop Units and Loop Complexes are the most walkable to the Danforth Campus. Neighborhood Complexes and most Scattered Units further from the Loop typically require the shuttle or MetroLink.",
                    },
                    {
                      q: "Are off-campus apartments near WashU furnished?",
                      a: "Loop Complexes almost always are. Most Loop Units and Scattered Units are not, and Neighborhood Complexes vary. Always check the listing.",
                    },
                    {
                      q: "Which type is best for grad or med students?",
                      a: "Neighborhood Complexes, especially in the CWE near the Medical Campus. Buildings along Waterman, Euclid, and Pershing near Kingshighway are on the WashU shuttle route and close to the med campus cluster.",
                    },
                    {
                      q: "How do I know if a landlord is good?",
                      a: "Read verified peer reviews from students who have actually lived there. This matters in every category but matters most for Scattered Units, where landlord quality varies the most.",
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
