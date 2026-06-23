import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ArrowRight, Clock3, Home } from "lucide-react";

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

const currentGuideSlug = "washu-parent-guide";
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
                Description: A parent’s guide to WashU housing: on-campus dorms,
                off-campus apartments near WashU, and what every family should
                know before their student signs.
              </p>

              <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-gray-950 sm:text-5xl lg:text-6xl">
                Your student is about to choose their first apartment. Here’s
                what you need to know.
              </h1>

              <div className="mt-8 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                  <Home size={18} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    By {currentGuide.author}
                  </p>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-xl">
                <div className="relative aspect-[4/3]">
                  <Image
                    src={currentGuide.image}
                    alt="WashU off-campus housing parent guide"
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
                    Junior year is when WashU housing decisions get real, and
                    most students sign leases without ever hearing from someone
                    who’s lived in the building. Here’s what parents need to
                    know about the on-campus to off-campus transition, the four
                    types of off-campus housing near WashU, and what every
                    family should know before their student signs a lease.
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
                <strong>
                  Junior year is the moment many WashU parents didn’t see
                  coming.
                </strong>
                Your student has likely lived on campus for two years, and now
                suddenly they’re texting you about leases and landlords. It can
                move fast. Here’s what nobody tells you upfront: you have more
                time than it feels like, and with the right information, the
                process doesn’t have to be as hard as it feels.
              </p>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Years 1 and 2: On-campus is required
                </h2>

                <p className="text-lg leading-8">
                  <strong>
                    WashU now requires freshmen and sophomores to live on
                    campus.
                  </strong>
                  For incoming first-years, students rank housing preferences
                  across six types. Modern or traditional, and single, double,
                  or triple. Modern dorms tend to be newer builds with
                  suite-style bathrooms. Traditional halls have the classic
                  corridor layout with communal bathrooms. Neither is better. It
                  depends entirely on your student’s personality.
                </p>

                <p className="text-lg leading-8">
                  <strong>Rising sophomores </strong>rank the same modern or
                  traditional, and single, double, or triple preferences, with
                  one extra choice: South 40 or the Village (WashU’s primary
                  housing area for sophomores and juniors).
                </p>

                <p className="text-lg leading-8">
                  If your student wants{" "}
                  <strong>real opinions before they rank</strong>,{" "}
                  <Link
                    href="/"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    Proximity’s
                  </Link>{" "}
                  on-campus hub lets them filter by room type and read verified
                  reviews from students who’ve actually lived in those specific
                  dorms. Real takes, from real students. Find it at{" "}
                  <Link
                    href="/CampusHub"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/CampusHub
                  </Link>
                  .
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Junior year: when the decision gets real
                </h2>

                <p className="text-lg leading-8">
                  <strong>
                    Sophomores rank preferences for specific dorms for junior
                    year.
                  </strong>{" "}
                  But with WashU enrollment at its second-highest point in
                  school history, more juniors are getting pushed out of their
                  first choice spots in the Village. Many are choosing to go
                  off-campus. And the finances often make a compelling case.
                </p>

                <p className="text-lg leading-8">
                  <strong>
                    WashU charges up to $19,500 per year for on-campus housing
                  </strong>
                  , a number that has jumped 15% in just three years. Off-campus
                  students consistently report paying $800 to $1,000 per month,
                  which works out to $9,600 to $12,000 annually. The gap can be
                  $7,000 or more per year.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  The four types of off-campus housing near WashU
                </h2>

                <p className="text-lg leading-8">
                  <strong>Not all off-campus housing is the same. </strong>
                  Here’s how it breaks down:
                </p>

                <p className="text-lg leading-8">
                  Units by the loop are smaller buildings on streets like
                  Washington, Kingsbury, and Waterman.
                  <strong>
                    Walkable, social, close to restaurants and other students.{" "}
                  </strong>
                  They feel like a real home. The buildings are older, so
                  landlord quality varies. Peer reviews matter most here.
                </p>

                <p className="text-lg leading-8">
                  Purpose-built Delmar Loop apartments are{" "}
                  <strong>usually furnished, often with amenities</strong> like
                  gyms, study rooms, pools, and even rooftop decks. Most have
                  per-bedroom leasing. This is typically the most expensive
                  option.
                </p>

                <p className="text-lg leading-8">
                  Neighborhood complexes are managed properties in areas like
                  the Central West End and Clayton.
                  <strong>
                    {" "}
                    Often the nicest apartments, with in-unit laundry and
                    stronger management.
                  </strong>{" "}
                  They’re farther from campus and the social scene, so
                  transportation matters. Students without cars will want to
                  confirm shuttle access before signing.
                </p>

                <p className="text-lg leading-8">
                  Scattered houses are independent rentals on quieter
                  residential streets. Yards, porches, brick, real character.
                  <strong>The most space for the price.</strong> Landlord
                  vetting is especially important here, in addition to
                  transportation.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  The part most students skip
                </h2>

                <p className="text-lg leading-8">
                  Here’s what the housing search actually looks like for most
                  WashU students.{" "}
                  <strong>
                    Zillow, Apartments.com, WashU ARS, a private landlord site,
                    Facebook groups, some word of mouth
                  </strong>
                  , and then a lease signed without ever hearing from anyone
                  who’s actually lived in that apartment. We surveyed 500+ WashU
                  students on how they find housing, and no single platform or
                  method came close to being dominant.
                </p>

                <p className="text-lg leading-8">
                  That gap, between finding a listing and knowing what you’re
                  signing into, is what Proximity was built to close for
                  students looking at apartments near WashU.{" "}
                  <strong>Verified student reviews</strong> of WashU dorms and
                  off-campus apartments, <strong>pre-vetted listings</strong>{" "}
                  tailored to WashU students with student-relevant filters,{" "}
                  <strong>and a free personalized housing match </strong>for
                  students who want help narrowing it down.
                </p>

                <p className="text-lg leading-8">
                  Better apartments. Honest reviews. No guesswork.
                </p>

                <p className="text-lg leading-8">
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
