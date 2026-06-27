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

const currentGuideSlug = "washu-apartment-checklist";
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
                <span className="text-sm text-gray-500">
                  Updated Jun 22, 2026
                </span>
              </div>

              <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600">
                Description: Before your WashU student signs an apartment lease,
                they should be able to answer these questions. A parent’s
                checklist for the off-campus housing search.
              </p>

              <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-gray-950 sm:text-5xl lg:text-6xl">
                Before your student signs a lease, make sure they can answer
                these questions.
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
                    alt="Apartment checklist"
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
                    Most WashU students sign an off-campus lease without ever
                    hearing from someone who’s lived in the building. This is a
                    parent’s checklist of questions every student should be able
                    to answer before signing, plus the context on WashU’s
                    housing timeline and off-campus options.
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
                  {" "}
                  Here’s a pattern that plays out every spring at WashU.{" "}
                </strong>
                A junior finds an apartment, loves it, signs the lease, and
                moves in before anyone has thought to ask even the most basic
                questions about the building, the landlord, or the neighborhood.
                It&apos;s not carelessness - it&apos;s just that nobody handed
                them a checklist. Consider this yours.
              </p>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Where your student is in the housing timeline
                </h2>

                <p className="text-lg leading-8">
                  <strong>
                    {" "}
                    WashU now requires freshmen and sophomores to live on campus{" "}
                  </strong>
                  , so for underclassmen, the question is which dorm, not which
                  apartment. First-years rank preferences across six room types:
                  modern or traditional, and single, double, or triple. Modern
                  dorms are newer builds with suite-style bathrooms. Traditional
                  halls have the classic corridor layout with communal
                  bathrooms. Neither is better. It depends on your student’s
                  personality and sleep schedule.
                </p>

                <p className="text-lg leading-8">
                  <strong>Rising sophomores </strong> rank the same modern or
                  traditional, and single, double, or triple preferences, with
                  one extra choice: South 40 or the Village (WashU’s primary
                  housing area for sophomores and juniors).
                </p>

                <p className="text-lg leading-8">
                  <a
                    href="https://useproximity.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    Proximity
                  </a>
                  ’s campus hub has verified student reviews filtered by room
                  type, actual opinions from students who’ve actually lived
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

                <p className="text-lg leading-8">
                  <strong>Junior year is when it gets more complicated.</strong>{" "}
                  Sophomores rank specific dorms, but with WashU enrollment at
                  its second-highest point in school history, more juniors are
                  getting pushed out of their top picks. Many choose to go
                  off-campus. WashU charges up to $19,500 per year for on-campus
                  housing, up 15% in just three years. Off-campus students
                  consistently pay $9,600 to $12,000 annually.{" "}
                  <strong>The gap can be $7,000 or more per year.</strong>
                </p>

                <p className="text-lg leading-8">
                  <strong>
                    Off-campus housing near WashU falls into four categories.
                  </strong>
                  Units by Delmar Loop are small, walkable buildings close to
                  campus and the social scene. Loop complexes are purpose-built
                  Delmar Loop apartments with amenities like pools and gyms, and
                  are typically the most expensive option. Neighborhood
                  complexes in areas like the Central West End or Clayton tend
                  to have the nicest finishes, but they’re farther out. Shuttle
                  access matters if your student doesn&apos;t have a car.
                  Scattered houses offer the most space and character, and
                  landlord vetting is especially important here.
                </p>

                <p className="text-lg leading-8">
                  <strong>
                    The financial case for going off-campus is strong.
                  </strong>{" "}
                  But the savings only hold if your student signs a good lease,
                  in a well-managed building, with a landlord who actually shows
                  up when something goes wrong.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  The checklist
                </h2>

                <p className="text-lg leading-8">
                  We surveyed 500+ WashU students on how they find housing. No
                  single method dominated. Most sign a lease without ever
                  hearing from someone who&apos;s actually lived in the
                  building. Before your student does, make sure they can answer
                  these.
                </p>

                <p className="text-lg leading-8">
                  <em>
                    Have your student screenshot this or save it on their phone
                    before their next apartment showing.
                  </em>
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Questions for the landlord
                </h2>

                <ul className="space-y-3 text-lg leading-8">
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      Who handles maintenance requests, and what’s the typical
                      response time?
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>What’s the policy if something breaks?</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      Is the landlord local, or is this managed by a property
                      company?
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>Which utilities are included, and which aren’t?</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      What does the lease say about subleasing? (if applicable)
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      How much is the security deposit, and what’s the typical
                      return amount?
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      Is a guarantor or co-signer required, and who qualifies?
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>What’s the building’s entry and security setup?</span>
                  </li>
                </ul>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Questions for anyone who’s lived there
                </h2>

                <ul className="space-y-3 text-lg leading-8">
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      How was the landlord when something actually went wrong?
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>Is the neighborhood safe?</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      Were there noise, pest, or building issues that weren’t
                      mentioned upfront?
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>How ready was the apartment on move-in day?</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>Would they live there again?</span>
                  </li>
                </ul>
              </section>

              <section className="space-y-4 border-t border-gray-200 pt-8">
                <p className="text-lg leading-8">
                  <strong>
                    Hearing from someone who’s actually lived there is the
                    hardest thing to get in a standard apartment search.
                  </strong>{" "}
                  It’s exactly what Proximity’s verified student reviews of
                  apartments near WashU are built for. WashU-specific listings,
                  honest peer reviews of dorms and off-campus apartments, and a
                  free personalized housing match for students who want help
                  narrowing it down.
                </p>

                <p className="text-lg leading-8">
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
            <section className="mt-16 border-t border-gray-200 pt-10">
              <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                Looking for housing near WashU?
              </h3>

              <p className="mt-4 text-lg leading-8 text-gray-600">
                Browse verified student reviews, explore off-campus listings, or
                get a personalized housing match based on your budget,
                preferences, and lifestyle.
              </p>

              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  href="/"
                  className="inline-flex items-center justify-center rounded-2xl bg-rose-600 px-5 py-3 font-semibold text-white transition hover:bg-rose-700"
                >
                  Explore housing
                </Link>

                <Link
                  href="/guides"
                  className="inline-flex items-center justify-center rounded-2xl border border-gray-300 px-5 py-3 font-semibold text-gray-900 transition hover:bg-gray-50"
                >
                  Read more guides
                </Link>
              </div>
            </section>
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
