import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Clock3, Home } from "lucide-react";

const guides = [
  {
    title: "WashU Apartment Checklist: Questions Before Signing",
    description:
      "A parent’s checklist for the off-campus housing search, built around the questions every WashU student should be able to answer before signing a lease.",
    author: "Ben Flicker, Founder of Proximity",
    category: "Checklist",
    readTime: "7 min read",
    slug: "washu-apartment-checklist",
    image: "/blog/washu-apartment-checklist.avif",
    summary:
      "Most students sign an off-campus lease without hearing from someone who’s actually lived in the building. This guide helps families and students vet the landlord, building, neighborhood, and lease terms before it is too late.",
    body: "WashU students need to know whether the landlord is local, what utilities are included, what the lease says about subleasing, and how the building handles maintenance, security, and move-in readiness. The guide also covers the difference between on-campus and off-campus housing, the four main categories of off-campus options, and why verified peer reviews matter so much in the search process.",
    tags: [
      "lease",
      "checklist",
      "landlord questions",
      "peer reviews",
      "utilities",
    ],
  },
  {
    title: "How Much Should I Budget for Off-Campus Rent Near WashU?",
    description:
      "A clear breakdown of what off-campus rent near WashU actually costs, including roommate count, neighborhoods, utilities, furniture, and lease length.",
    author: "Ben Flicker, Founder of Proximity",
    category: "Budgeting",
    readTime: "10 min read",
    slug: "washu-off-campus-budget",
    image: "/blog/washu-off-campus-budget.avif",
    summary:
      "This guide gives students a real reference point before they start touring apartments. It explains how rent changes by roommate count, neighborhood, and whether utilities or furniture are included.",
    body: "The guide explains typical off-campus rent near WashU, showing how solo living, two-person splits, and three-person splits change the monthly number. It breaks down neighborhoods like the Delmar Loop, University City, Skinker-DeBaliviere, Central West End, and Clayton, then covers furnished versus unfurnished units, utilities included, lease length, and subleasing. It also explains why the best units are usually claimed by spring and why comparing all-in cost matters more than the listing price alone.",
    tags: [
      "rent",
      "budget",
      "roommates",
      "utilities",
      "neighborhoods",
      "lease length",
    ],
  },
  {
    title: "WashU Move-In Tips: What Nobody Tells You About Moving Off-Campus",
    description:
      "The move-in tips nobody tells WashU students. Utilities, WiFi, renters insurance, move-in documentation, and the mistakes that can cost you time and money.",
    author: "Ben Flicker, Founder of Proximity",
    category: "Moving",
    readTime: "8 min read",
    slug: "washu-move-in-tips",
    image: "/blog/washu-move-in-tips.avif",
    summary:
      "Moving off-campus near WashU comes with hidden deadlines and common mistakes. This guide covers utilities, internet setup, renters insurance, documenting your unit, and preparing for move-in day.",
    body: "Students often forget to set up Ameren, Spire, internet service, renters insurance, and move-in documentation before arriving. This guide walks through everything that should happen before move-in day, on move-in day, and during the first week in a new apartment.",
    tags: [
      "move in",
      "utilities",
      "ameren",
      "spire",
      "wifi",
      "renters insurance",
      "moving",
    ],
  },
  {
    title: "WashU Off-Campus Housing: A Parent's Guide",
    description:
      "A parent's guide to WashU housing, from dorms and Village housing to off-campus apartments, landlords, leases, and housing costs.",
    author: "Ben Flicker, Founder of Proximity",
    category: "Parents",
    readTime: "6 min read",
    slug: "washu-parent-guide",
    image: "/blog/washu-parent-guide.avif",
    summary:
      "Everything WashU parents should know about the transition from on-campus housing to off-campus apartments, including costs, housing options, and common mistakes students make.",
    body: "Junior year is when housing decisions become real for WashU students. This guide explains dorm options, off-campus housing categories, costs, landlord considerations, and how parents can help students make informed housing decisions.",
    tags: [
      "parents",
      "housing guide",
      "off campus housing",
      "leases",
      "landlords",
      "washu housing",
    ],
  },
  {
    title: "The 4 Types of Off-Campus Housing Near WashU",
    description:
      "Not all apartments near WashU are the same. Learn the differences between Loop Units, Loop Complexes, Neighborhood Complexes, and Scattered Units.",
    author: "Ben Flicker, Founder of Proximity",
    category: "Housing Search",
    readTime: "9 min read",
    slug: "four-types-washu-housing",
    image: "/blog/four-types-washu-housing.avif",
    summary:
      "A breakdown of the four major categories of off-campus housing near WashU, including pricing, location, amenities, and which type fits different students.",
    body: "Students searching for housing near WashU often compare apartments that aren't truly comparable. This guide explains the four major housing categories, their tradeoffs, pricing, locations, and who each type is best suited for.",
    tags: [
      "housing types",
      "loop",
      "apartments",
      "off campus",
      "neighborhoods",
      "housing search",
      "washu",
    ],
  },
];

const currentGuideSlug = "four-types-washu-housing";
const currentGuide = guides.find((guide) => guide.slug === currentGuideSlug);
const relatedGuides = guides.filter((guide) => guide.slug !== currentGuideSlug);

export default function Page() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link
            href="/guides"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 transition hover:text-rose-600"
          >
            <ArrowLeft size={16} />
            Back to guides
          </Link>
        </div>
      </section>

      <section className="relative overflow-hidden border-b border-gray-200 bg-gradient-to-br from-rose-50 via-white to-gray-50">
        <div className="absolute -top-24 right-[-6rem] h-96 w-96 rounded-full bg-rose-200/40 blur-3xl" />
        <div className="absolute bottom-[-5rem] left-[-4rem] h-80 w-80 rounded-full bg-orange-100/60 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-6 py-12 lg:py-14">
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">
                  {currentGuide.category}
                </span>
                <span className="flex items-center gap-1 text-sm text-gray-500">
                  <Clock3 size={14} /> {currentGuide.readTime}
                </span>
              </div>

              <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600">
                Students searching for off-campus housing near WashU run into
                the same problem early: they&apos;re comparing apartments that
                aren&apos;t even in the same ballpark.
              </p>

              <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-gray-950 sm:text-5xl lg:text-6xl">
                The 4 Types of Off-Campus Housing Near WashU (and Which Is Right
                for You)
              </h1>

              <div className="mt-8 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                  <Home size={18} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    By {currentGuide.author}
                  </p>
                  <p className="text-sm text-gray-500">
                    Written for WashU students and families
                  </p>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-xl">
                <div className="relative aspect-[4/3]">
                  <Image
                    src={currentGuide.image}
                    alt="Off-campus housing near WashU"
                    fill
                    priority
                    className="object-cover"
                  />
                </div>
                <div className="border-t border-gray-200 p-5">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-500">
                    Summary
                  </p>
                  <p className="mt-3 text-base leading-7 text-gray-600">
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

      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
          <article className="min-w-0">
            <div className="space-y-10 text-gray-800">
              <p className="text-lg leading-8">
                Students searching for off-campus housing near WashU run into
                the same problem early: they&apos;re comparing apartments that
                aren&apos;t even in the same ballpark. A two-bedroom in a duplex
                near the Loop and a fully furnished complex with a gym and
                dedicated amenities floor on Delmar are both &quot;apartments
                near WashU,&quot; but the price range, the lifestyle, and the
                trade-offs are vastly different.
              </p>

              <p className="text-lg leading-8">
                Off-campus housing near WashU comes down to four distinct types:
                Loop Units, Loop Complexes, Neighborhood Complexes, and
                Scattered Units. Once you know which type you&apos;re looking
                for, the search gets way simpler. This guide walks through all
                four and helps you figure out which one fits how you actually
                want to live.
              </p>

              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
                  Key Takeaways
                </p>

                <ul className="mt-4 space-y-3 text-lg leading-8 text-gray-800">
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span>
                      The four types are not comparable to each other. Comparing
                      a loop unit to a loop complex is like comparing a walk-up
                      in Brooklyn to a doorman building.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span>Loop complexes are the most expensive category.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span>
                      Furnished options and unfurnished options have a large
                      price gap, especially by the Loop. Renting or purchasing
                      your own furniture is often more cost-efficient.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span>
                      In every category, the landlord matters as much as the
                      building. Peer reviews from actual tenants are the
                      highest-leverage thing you can check before signing.
                    </span>
                  </li>
                </ul>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  A Quick Map of the Four Types
                </h2>

                <p className="text-lg leading-8">
                  Before getting into each one, here is the 30-second
                  orientation. Loop units are walkable, older, and rooted in
                  real neighborhood character. Loop complexes are furnished,
                  amenity-heavy buildings right on Delmar. Neighborhood
                  complexes are modern, managed buildings a bit further from the
                  action. Scattered units are individual apartments and houses
                  spread across the WashU-adjacent neighborhoods, which have the
                  most space and character for the money.
                </p>

                <p className="text-lg leading-8">
                  Here is how to tell them apart and who each one is actually
                  for.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Type 1: Loop Units
                </h2>

                <p className="text-lg leading-8">
                  <strong>Walkable, with real neighborhood character.</strong>
                </p>

                <p className="text-lg leading-8">
                  This is the classic WashU off-campus experience. Older
                  apartment buildings and flats on and around the Delmar Loop,
                  on streets like Leland, Westgate, Heman, Interdrive, and
                  Washington in University City. Students have rented here for
                  generations. You can walk to campus, walk to the Loop&apos;s
                  restaurants and bars, and walk to Forest Park.
                </p>

                <p className="text-lg leading-8">
                  <strong>What stands out:</strong> Real character. Hardwood
                  floors, high ceilings, and often a porch or backyard.
                  Landlords here tend to know the student rental market well.
                </p>

                <p className="text-lg leading-8">
                  <strong>Things to consider:</strong> Older buildings mean
                  maintenance responsiveness matters. Ask about it before
                  signing. The Loop gets noisy on weekends, especially on units
                  right on Delmar. Almost all loop units are unfurnished, so
                  plan for that on move-in. Laundry varies by building. Basement
                  laundry is common in older buildings, though some units
                  include it in-unit. Landlords in this area are used to renting
                  to students and may be open to shorter lease terms. Expect a
                  premium if you need less than 12 months, and know that
                  semester leases are still uncommon across the board.
                </p>

                <p className="text-lg leading-8">
                  <strong>Price feel: </strong>Moderate. A 3-bedroom split
                  across three people runs well below the Loop Complex tier.
                  Older units in this category offer some of the best per-person
                  value closest to campus and the action.
                </p>

                <p className="text-lg leading-8">
                  <strong>Best for: </strong> Students who want to be in the
                  middle of the social scene, walk everywhere, and are
                  comfortable with a building that has some character and no
                  amenities.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Type 2: Loop Complexes
                </h2>

                <p className="text-lg leading-8">
                  <strong>Furnished, amenity-rich, right in the Loop.</strong>
                </p>

                <p className="text-lg leading-8">
                  Purpose-built modern buildings on or near the Loop. The
                  majority are new construction or gut renovations, fully
                  furnished, and built for student living, like LOCAL on Delmar,
                  University Square, and Kingsland Courtyard.
                </p>

                <p className="text-lg leading-8">
                  <strong>What stands out:</strong> Location right on or
                  adjacent to Delmar. Fully furnished units: beds, couches,
                  desks, appliances all included. Often have study lounges,
                  fitness centers, and community spaces built in. Number of
                  bathrooms typically matches the number of bedrooms. In-unit
                  laundry is standard across this category.
                </p>

                <p className="text-lg leading-8">
                  Many buildings in this tier offer per-bedroom leases, which
                  means you can rent without worrying about being responsible
                  for someone else&apos;s rent. You can also lease without a
                  pre-formed group, and the building handles matching. Check the
                  specific structure before assuming.
                </p>

                <p className="text-lg leading-8">
                  <strong>Things to consider:</strong>This is the top of the
                  market per month. Per-person rates at the newer complexes can
                  push toward $2,000/month for a solo setup, and even shared
                  configurations stay premium ($1000+). Larger buildings mean
                  less privacy. Some students love the built-in community feel,
                  while others dislike it. If leaving dorm-style living behind
                  is the goal, this category is worth reconsidering.
                </p>

                <p className="text-lg leading-8">
                  <strong>Price feel: </strong>Premium. The most expensive
                  category per person, by a meaningful margin.
                </p>

                <p className="text-lg leading-8">
                  <strong>Best for</strong>Students who prioritize convenience,
                  security, zero setup, and who like the energy of a bigger
                  building with a built-in community.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Type 3: Neighborhood Complexes
                </h2>

                <p className="text-lg leading-8">
                  <strong>Modern, quiet, well-maintained buildings.</strong>
                </p>

                <p className="text-lg leading-8">
                  Professionally managed buildings a bit further from the Loop.
                  Buildings along Pershing, in the Skinker-DeBaliviere corridor,
                  or across Forest Park in the Central West End. The range
                  within this category is wide. Most use standard 12-month
                  leases. The Delmonte is one of the few buildings near WashU
                  that offers true semester lease terms. Others in this corridor
                  have 6-month minimums, which can work for a 10-month academic
                  year.
                </p>

                <p className="text-lg leading-8">
                  Some examples include The Delmonte, at 5622 Delmar, which sits
                  between the Loop and the CWE, Lofts at Euclid and Lofts at
                  Forest Park in the CWE, Park Lux on Pershing, and Echo
                  apartments on Enright Avenue.
                </p>

                <p className="text-lg leading-8">
                  The CWE properties deserve a clear note: they are far from the
                  Danforth Campus relative to other locations. WashU&apos;s
                  shuttle and the MetroLink make it workable (or if you have a
                  car), but the distance is definitely something to consider.
                  The CWE is much closer to the Medical Campus than to the main
                  campus, so if that&apos;s where you&apos;re commuting,
                  disregard the note above.
                </p>

                <p className="text-lg leading-8">
                  <strong>What stands out:</strong> Modern finishes and
                  professional management, often at better value per square foot
                  than the Loop complexes. Typically quieter setting, strong
                  maintenance response, and well-equipped common areas.
                </p>

                <p className="text-lg leading-8">
                  <strong>Things to consider: </strong>You will typically need
                  the shuttle, MetroLink, or a short drive to reach Danforth
                  Campus. Lease structures vary across this category. Some
                  buildings offer per-bedroom leases, others require a joint
                  lease with your full group. Furnished options are less
                  consistent here than in the Loop Complex tier.
                </p>

                <p className="text-lg leading-8">
                  <strong>Price feel: </strong>Varies. CWE buildings tend to run
                  on the higher end. Pershing-area and Skinker-corridor options
                  often offer stronger value for the finish level you get.
                </p>

                <p className="text-lg leading-8">
                  <strong>Best for: </strong>Students who want a modern,
                  well-run building and are willing to trade walkability for it.
                  If you want to live solo, these often have the highest value
                  options. Particularly popular with grad and medical students
                  whose priority is the Medical Campus over the Loop.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Type 4: Scattered Units
                </h2>

                <p className="text-lg leading-8">
                  <strong>
                    The most space for your dollar, private, and versatile.
                  </strong>
                </p>

                <p className="text-lg leading-8">
                  Individual apartments and houses in smaller buildings spread
                  across the WashU-adjacent neighborhoods. Classic St. Louis
                  brick flats, duplexes, and houses on streets like Pershing,
                  McPherson, and Corbitt in the Skinker-DeBaliviere and
                  University City areas. The most character and typically the
                  most square footage for the money.
                </p>

                <p className="text-lg leading-8">
                  Per-person rates in the $500-to-$800 range appear regularly -
                  some of the lowest prices near campus.
                </p>

                <p className="text-lg leading-8">
                  <strong>What stands out: </strong> The best per-person value,
                  when splitting with roommates. Yards, porches, and actual
                  house character. More privacy than a 100-unit complex and more
                  flexibility (some landlords here will negotiate on lease
                  timing or term in ways larger operators won&apos;t).
                </p>

                <p className="text-lg leading-8">
                  <strong>Things to consider:</strong> Landlord quality varies
                  more in this category than any other. A well-managed scattered
                  unit is a real deal. A poorly managed one means slow
                  maintenance and deposit disputes. Some landlords here offer
                  academic-year leases or 6-month minimums that are hard to find
                  across the other categories. Peer reviews from students who
                  have actually lived there are crucial here. Read landlord
                  reviews on Proximity before you sign: useproximity.org
                </p>

                <p className="text-lg leading-8">
                  <strong>Price feel:</strong> Affordable when splitting with
                  roommates.
                </p>

                <p className="text-lg leading-8">
                  <strong>Best for: </strong>Groups who want maximum space and a
                  real home feel, and who are willing to research the landlord
                  carefully.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  How to Choose the Right Off-Campus Housing Near WashU
                </h2>

                <p className="text-lg leading-8">
                  A few quick questions if you want to self-sort:
                </p>

                <ul className="space-y-3 text-lg leading-8">
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      <strong>
                        Walk everywhere and be in the middle of things?{" "}
                      </strong>
                      Loop Units or Loop Complexes.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      <strong>
                        Modern, furnished, zero setup, and cost is not the
                        deciding factor?{" "}
                      </strong>
                      Loop Complexes.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      <strong>Modern and quiet, fine with the shuttle?</strong>{" "}
                      Neighborhood Complexes.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      <strong>
                        Group looking for the most space at the lowest
                        per-person cost?{" "}
                      </strong>
                      Scattered Units.
                    </span>
                  </li>
                </ul>

                <p className="text-lg leading-8">
                  If you already know which type fits, note it when you submit
                  the matchmaking form. It helps us narrow faster.
                </p>

                <p className="text-lg leading-8">
                  Not sure yet? That is what the form is for. Rank your
                  preferences and provide your budget, location preferences,
                  group size, and lease ter,. We figure out the type and the
                  unit that matches you best.
                </p>

                <p className="text-lg leading-8">
                  Get a free housing match:{" "}
                  <Link
                    href="/matchmaking"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/matchmaking
                  </Link>
                </p>

                <p className="text-lg leading-8">
                  Once you know your type, the next question is what it costs.
                  The companion guide breaks down realistic budgets by
                  neighborhood and group size:{" "}
                  <Link
                    href="/guides/washu-off-campus-budget"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    How Much Should I Budget for Off-Campus Rent Near WashU
                  </Link>
                  .
                </p>
              </section>

              <section className="space-y-4 border-t border-gray-200 pt-8">
                <p className="text-lg leading-8">
                  Knowing the four types turns a disorienting search into a
                  clear one. Instead of scrolling through hundreds of listings
                  that do not obviously compare to each other, you can filter to
                  the type that actually fits how you want to live.
                </p>

                <p className="text-lg leading-8">
                  Proximity is built around exactly this: verified peer reviews
                  of real WashU buildings, honest information on each type, and
                  a free personalized match based on your budget, group size,
                  commute preference, and lease term.
                </p>

                <p className="text-lg leading-8">
                  Get a free housing match:{" "}
                  <Link
                    href="/matchmaking"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/matchmaking
                  </Link>
                </p>

                <p className="text-lg leading-8">
                  Browse verified WashU listings and peer reviews:{" "}
                  <Link
                    href="/"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org
                  </Link>
                </p>
              </section>

              <section className="space-y-6 border-t border-gray-200 pt-8">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  FAQ: Quick Answers
                </h2>

                <div className="space-y-6">
                  <section className="space-y-3">
                    <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                      What is the cheapest type of off-campus housing near
                      WashU?
                    </h3>
                    <p className="text-lg leading-8">
                      Scattered Units, when split across a group. Some 3-bedroom
                      flats in the Skinker-DeBaliviere area come in at under
                      $500 per person. Older Loop Units close to the action are
                      also solid value.
                    </p>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                      Which type is best for being close to campus?
                    </h3>
                    <p className="text-lg leading-8">
                      Loop Units and Loop Complexes are the most walkable to the
                      Danforth Campus. Neighborhood Complexes and most Scattered
                      Units further from the Loop typically require the shuttle
                      or MetroLink.
                    </p>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                      Are off-campus apartments near WashU furnished?
                    </h3>
                    <p className="text-lg leading-8">
                      Loop Complexes almost always are. Most Loop Units and
                      Scattered Units are not, and Neighborhood Complexes vary.
                      Always check the listing. Listings on Proximity have a
                      furnishing option built in directly for unfurnished units.
                    </p>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                      Which type of University City student housing is best for
                      grad or med students?
                    </h3>
                    <p className="text-lg leading-8">
                      Neighborhood Complexes, especially in the CWE near the
                      Medical Campus. Buildings along Waterman, Euclid, and
                      Pershing near Kingshighway are on the WashU shuttle route
                      and close to the med campus cluster.
                    </p>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                      How do I know if a landlord is good?
                    </h3>
                    <p className="text-lg leading-8">
                      Read verified peer reviews from students who have actually
                      lived there. This matters in every category but matters
                      most for Scattered Units, where landlord quality varies
                      the most. Proximity ranks listings by review volume, not
                      paid placement. What you see reflects actual tenant
                      experience.
                    </p>
                  </section>
                </div>
              </section>
            </div>
          </article>

          <aside className="hidden lg:block">
            <div className="sticky top-36">
              <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 p-5">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-500">
                    Keep reading
                  </p>

                  <h3 className="mt-2 text-xl font-bold tracking-tight text-gray-950">
                    Related articles
                  </h3>
                </div>

                <div className="space-y-4 p-4">
                  {relatedGuides.slice(0, 2).map((guide) => (
                    <Link
                      key={guide.slug}
                      href={`/guides/${guide.slug}`}
                      className="group block overflow-hidden rounded-2xl border border-gray-200 transition hover:border-rose-200 hover:shadow-md"
                    >
                      <div className="relative aspect-[16/9]">
                        <Image
                          src={guide.image}
                          alt={guide.title}
                          fill
                          className="object-cover"
                        />
                      </div>

                      <div className="p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-500">
                          {guide.category}
                        </p>

                        <h4 className="mt-2 font-semibold leading-6 text-gray-950 group-hover:text-rose-600">
                          {guide.title}
                        </h4>

                        <p className="mt-2 text-sm text-gray-500">
                          {guide.readTime}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
