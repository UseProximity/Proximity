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

const currentGuideSlug = "washu-off-campus-budget";
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
                Description: A clear breakdown of what off-campus rent near
                WashU actually costs, including roommate count, neighborhoods,
                utilities, furniture, and lease length.
              </p>

              <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-gray-950 sm:text-5xl lg:text-6xl">
                How Much Should I Budget for Off-Campus Rent Near WashU?
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
                    alt="Off-campus rent near WashU"
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

      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
          <article className="min-w-0">
            <div className="space-y-10 text-gray-800">
              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
                  Key Takeaways
                </p>

                <ul className="mt-4 space-y-3 text-lg leading-8 text-gray-800">
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span>
                      Living off-campus is significantly cheaper than staying on
                      campus.
                    </span>
                  </li>

                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span>
                      Most students pay $700 to $1,100 per person per month for
                      off-campus housing, depending on roommates and location.
                    </span>
                  </li>

                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span>
                      Roommate count is the biggest lever. Going from solo to a
                      three person split can roughly halve your monthly rent.
                    </span>
                  </li>

                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span>
                      Always compare all-in cost. Utilities can swing your real
                      monthly number significantly.
                    </span>
                  </li>

                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span>
                      The best units near WashU get claimed by spring. Start
                      looking as early as possible.
                    </span>
                  </li>
                </ul>
              </section>

              <p className="text-lg leading-8">
                WashU charges up to $19,500 per year for on-campus housing, up
                15% in just three years. Off-campus students consistently pay
                $9,600 to $12,000 annually. The gap can be $7,000 or more per
                year, and many upperclassmen undergrads don&apos;t realize this.
              </p>

              <p className="text-lg leading-8">
                That gap is huge, and it&apos;s why this guide on off-campus
                rent near WashU exists. Most students start the search with no
                reference point. They anchor on whatever their friends paid or
                the first few listings they opened. This gives you the lay of
                the land before you start looking, specific to the St. Louis
                market.
              </p>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  What&apos;s Normal for Off-Campus Rent Near WashU
                </h2>

                <p className="text-lg leading-8">
                  Most WashU students living off-campus land somewhere in the
                  $700 to $1,100 per person per month range. It comes down to
                  three things: how many roommates you have, how new the
                  building is, and how close you are to campus and the Delmar
                  Loop.
                </p>

                <p className="text-lg leading-8">
                  Solo living is the most expensive by a wide margin. A studio
                  or one-bedroom in an older building might start around $900 a
                  month for the whole unit on a full-year lease. In a new,
                  full-amenity building on or near Delmar, that solo situation
                  can be $2,000+ a month. Splitting with roommates is where the
                  real savings are.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  How Roommates Change Everything
                </h2>

                <p className="text-lg leading-8">
                  The single most powerful budgeting lever you have isn&apos;t
                  the neighborhood you pick or the amenities you give up.
                  It&apos;s how many people you live with.
                </p>

                <p className="text-lg leading-8">
                  Here&apos;s what the math looks like:
                </p>

                <ul className="space-y-3 text-lg leading-8">
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      <strong>Solo (studio or 1BR): </strong>Depending on the
                      building and location, rent typically runs somewhere
                      between $900 and $2,000+ a month, with no one to split the
                      rent with.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      <strong>Two people (2BR): </strong>Splitting a two-bedroom
                      typically brings each person into the $700 to $900 range
                      per month.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      <strong>Three people (3BR): </strong>Often the sweet spot.
                      Groups of three frequently land in the $500 to $800 per
                      person range, and three-bedrooms near WashU are common
                      enough that you have real options at this size.
                    </span>
                  </li>
                </ul>

                <p className="text-lg leading-8">
                  In other words, more roommates = significant savings. Going
                  from living solo to splitting a three-bedroom can roughly cut
                  your monthly rent close to in half. Over a year, that&apos;s
                  thousands of dollars per person.
                </p>

                <p className="text-lg leading-8">
                  If budget is your top priority, your roommate count matters
                  more than almost any other variable.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  What Rent Looks Like by Neighborhood
                </h2>

                <p className="text-lg leading-8">
                  The type of building you choose matters as much as the
                  neighborhood, and so does how far you&apos;re willing to walk
                  to campus. A large complex near the Loop gives you amenities
                  and a built-in community feel. A smaller, more private
                  building a few blocks off Delmar tends to trade that for lower
                  rent and more independence. A shared house can deliver the
                  best per-person value but usually means being a bit further
                  from campus. If you&apos;re not sure which fits your
                  situation, we break down{" "}
                  <Link
                    href="/guides/four-types-washu-housing"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    all four types of WashU off-campus housing
                  </Link>{" "}
                  in a separate guide.
                </p>

                <p className="text-lg leading-8">
                  Here&apos;s how the main neighborhoods around campus compare
                  on cost:
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  The Delmar Loop and University City
                </h3>

                <p className="text-lg leading-8">
                  The largest share of off-campus WashU students live here. Loop
                  units are typically a 15 to 25 minute walk to campus,
                  depending on the block. It&apos;s walkable to restaurants,
                  coffee, bars, and shuttle stops. It&apos;s the most in-demand
                  area near campus, which means good units go fast and the best
                  prices get claimed early in the year.
                </p>

                <p className="text-lg leading-8">
                  The budget spread here is wide. Older walk-ups and shared
                  houses in U City can offer solid per-person value. New amenity
                  buildings on or near Delmar sit at the premium end and can run
                  well past $1,200 per person. The same neighborhood has both
                  ends of the market.
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Skinker-DeBaliviere
                </h3>

                <p className="text-lg leading-8">
                  Just south of the Loop and east toward Skinker. Often the best
                  per-person value for quality units close to campus. Typically
                  a 15 to 25 minute walk to campus, good shuttle access, and
                  full of solid older brick buildings and renovated flats.
                </p>

                <p className="text-lg leading-8">
                  There&apos;s less nightlife density than being right on
                  Delmar, but the proximity to campus is essentially the same.
                  For groups looking to stretch their budget without sacrificing
                  location, this is consistently one of the stronger areas to
                  lease in near WashU.
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Central West End
                </h3>

                <p className="text-lg leading-8">
                  East of campus, across Forest Park. A walkable neighborhood
                  with a strong restaurant scene and a real commercial strip.
                  However, it&apos;s not walkable to the Danforth campus.
                  Students here lean on the WashU shuttle, MetroLink, or their
                  car.
                </p>

                <p className="text-lg leading-8">
                  If you&apos;re commuting to the medical school, this is where
                  I&apos;d look first. It has the highest density of med
                  students, close to the med campus, and has options at all
                  price ranges.
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Clayton
                </h3>

                <p className="text-lg leading-8">
                  Southeast of campus. Upscale and quiet, with very few
                  undergrads clustered here. The farthest from the Loop social
                  scene, and the shuttle is less frequent than the Loop-side
                  routes. However, for those very concerned about safety, this
                  is widely considered the best place to be.
                </p>

                <p className="text-lg leading-8">
                  Clayton is the most expensive area around WashU. Rents run
                  well above the broader St. Louis market. It makes sense for
                  students who prioritize quiet and a polished neighborhood over
                  proximity to campus and nightlife, but going in with clear
                  expectations about cost matters.
                </p>

                <p className="text-lg leading-8">
                  Aside from Clayton, the closer you are to campus and the
                  Delmar Loop for the same quality apartment, the more you pay.
                  Moving a few blocks out or choosing an older building is the
                  easiest lever for bringing your number down, especially if you
                  want to live solo.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Furnished vs. Unfurnished: The Price Gap Near the Loop
                </h2>

                <p className="text-lg leading-8">
                  Near the Delmar Loop, whether a unit comes furnished is one of
                  the biggest pricing variables students overlook. Fully
                  furnished buildings in the area can run significantly more per
                  month than comparable unfurnished units nearby. Over a full
                  lease term, that difference is real money.
                </p>

                <p className="text-lg leading-8">
                  There are three ways to approach it:
                </p>

                <p className="text-lg leading-8">
                  <strong>Pay the premium for a furnished unit.</strong> Some
                  buildings near the Loop bundle furniture, utilities, and
                  amenities into one monthly price. Convenient, but you&apos;re
                  paying for that convenience for the entire lease, whether you
                  need it or not.
                </p>

                <p className="text-lg leading-8">
                  <strong>Rent furniture for an unfurnished listing.</strong> On
                  any unfurnished listing on Proximity, there&apos;s a
                  &quot;Furnish This Property&quot; button. It connects you to
                  student furniture bundles for $139 or $169 a month, so your
                  place is move-in ready on day one. For students who want
                  flexibility without committing to a pre-furnished building,
                  this is often the better math. We pursued this partnership for
                  this exact reason.
                </p>

                <p className="text-lg leading-8">
                  <strong>Buy furniture from the previous tenant.</strong> This
                  is a very underrated move many people don’t consider. Previous
                  tenants frequently discard or sell furniture at move-out. Ask
                  your landlord to put you in touch with the outgoing tenant
                  before they leave. If the landlord pushes back on making that
                  introduction, take that as a signal about how they handle
                  landlord-tenant communication generally, and is a huge red
                  flag.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  The Hidden Cost: What &quot;Utilities Included&quot; Actually
                  Means
                </h2>

                <p className="text-lg leading-8">
                  Utility costs are one thing landlords tend to purposefully
                  hide, and it materially changes your real monthly cost.
                </p>

                <p className="text-lg leading-8">
                  Listings near WashU vary wildly on utilities. Some include
                  everything: heat, electric, gas, water, sewer, trash, and
                  internet. Some include only water and trash, and some include
                  nothing. That difference can swing your true monthly cost by
                  hundreds of dollars, which is enough to make a nominally
                  cheaper apartment actually more expensive than one listed at a
                  higher price.
                </p>

                <p className="text-lg leading-8">
                  Before you sign anything, ask:
                </p>

                <ul className="space-y-3 text-lg leading-8">
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>Which utilities are included in the rent?</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>Who pays gas, electric, and internet?</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      Is internet already set up in the building, or do you have
                      to arrange your own provider? And is there even a choice
                      of provider in that building?
                    </span>
                  </li>
                </ul>

                <p className="text-lg leading-8">
                  When you compare two places, compare the all-in monthly cost,
                  not just the rent number on the listing. This is a lot of
                  work, and exactly why we built the Proximity Matchmaking
                  Service, so you don&apos;t have to compare them manually. A
                  slightly higher rent with everything included often beats a
                  lower rent where you&apos;re separately covering heat through
                  a St. Louis winter.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Lease Length: What You Actually Need to Know
                </h2>

                <p className="text-lg leading-8">
                  Most landlords near WashU default to 12-month leases. If you
                  will be there all year, this is not an issue. The complication
                  comes when your timeline doesn&apos;t fit that mold: studying
                  abroad for a semester, arriving in January, or leaving in May
                  when your lease runs through August.
                </p>

                <p className="text-lg leading-8">
                  <strong>
                    Semester and shorter leases exist, but they cost more.{" "}
                  </strong>
                  Across university housing markets, semester and academic-year
                  leases typically run 10 to 25 percent more per month than
                  12-month leases. Landlords price in the higher turnover and
                  the risk of vacancy between terms. That premium shows up in
                  the St. Louis market too, and it&apos;s worth factoring into
                  your comparison when a flexible-term unit looks appealing at
                  first glance.
                </p>

                <p className="text-lg leading-8">
                  That said, some landlords near WashU do offer academic-year or
                  semester options alongside their standard 12-month lease.
                  It&apos;s not always advertised, so use{" "}
                  <Link
                    href="/matchmaking"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/matchmaking
                  </Link>{" "}
                  to get the full picture.
                </p>

                <p className="text-lg leading-8">
                  <strong>
                    If you sign a 12-month lease and need to leave after one
                    semester, subletting is the most common solution.
                  </strong>
                  The catch is that finding a subletter is not always easy.
                  Spring subleases are significantly harder to fill due to the
                  biggest subletter demographic being those going abroad in the
                  spring. Some leases also restrict subletting entirely, so make
                  sure to find out before planning around that option.
                </p>

                <p className="text-lg leading-8">
                  If you need to list your unit for sublet, you can do it for
                  free on Proximity at useproximity.org/add-sublease. It gets in
                  front of students actively looking for flexible or
                  shorter-term housing near WashU.
                </p>
                <p className="text-lg leading-8">
                  If you need to list your unit for sublet, you can do it for
                  free on Proximity at{" "}
                  <Link
                    href="/add-sublease"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/add-sublease
                  </Link>
                  . It gets in front of students actively looking for flexible
                  or shorter-term housing near WashU.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Skip the Guesswork
                </h2>

                <p className="text-lg leading-8">
                  The students who get a good deal on off-campus housing
                  aren&apos;t lucky; they went in knowing what&apos;s normal.
                  Most people start with no reference point and decide based on
                  vibes or whatever their friends paid previously.
                </p>

                <p className="text-lg leading-8">
                  Proximity gives WashU students verified peer reviews of actual
                  buildings and landlords, honest pricing context from real
                  listings, and a free personalized match based on their actual
                  budget, group size, commute preference, and lease term.
                </p>

                <p className="text-lg leading-8">
                  Get a free housing match at{" "}
                  <Link
                    href="/matchmaking"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/matchmaking
                  </Link>
                  .
                </p>

                <p className="text-lg leading-8">
                  Browse verified WashU listings and peer reviews at{" "}
                  <Link
                    href="/browse"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/browse
                  </Link>
                  .
                </p>
              </section>

              <section className="space-y-6 border-t border-gray-200 pt-8">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  FAQ: WashU Off-Campus Rent, Quick Answers
                </h2>

                <div className="space-y-6">
                  <section className="space-y-3">
                    <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                      How much is rent near WashU per month?
                    </h3>
                    <p className="text-lg leading-8">
                      Most students land somewhere in the $700 to $1,100 per
                      person range, depending on roommates, building type, and
                      location. Solo living runs higher, often between $900 and
                      $2,000-plus a month for the whole unit, depending on how
                      new and amenity-heavy the building is.
                    </p>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                      Is off-campus housing cheaper than the WashU dorms?
                    </h3>
                    <p className="text-lg leading-8">
                      Yes, usually by a meaningful amount. WashU&apos;s
                      on-campus housing runs up to $19,500 per year, while
                      off-campus students consistently pay $9,600 to $12,000
                      annually. That gap can be $7,000 or more per year. You
                      take on utilities, furniture, and landlord coordination in
                      exchange.
                    </p>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                      What&apos;s the cheapest way to live near WashU?
                    </h3>
                    <p className="text-lg leading-8">
                      More roommates in an older building a few blocks off the
                      Loop. Skinker-DeBaliviere and similar pockets tend to
                      offer the best per-person value for students willing to
                      move a short distance from the main commercial strip.
                      Groups of three or four have the most options at the lower
                      end of the market.
                    </p>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                      Do I need a guarantor or co-signer?
                    </h3>
                    <p className="text-lg leading-8">
                      Many WashU-area landlords require one for students without
                      income or established credit history. Requirements vary by
                      landlord, so ask each one directly before you get too far
                      into the process.
                    </p>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                      When should I start looking?
                    </h3>
                    <p className="text-lg leading-8">
                      January through March is peak season near WashU. The
                      best-value units are typically claimed by spring. Starting
                      early gives you more options and more time to make a
                      considered decision rather than a rushed one.
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
