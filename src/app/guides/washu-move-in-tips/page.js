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

const currentGuideSlug = "washu-move-in-tips";
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
                Moving off-campus near WashU? Set up Ameren and Spire early,
                book your WiFi install, and protect your deposit. The move-in
                tips no one tells you.
              </p>

              <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-gray-950 sm:text-5xl lg:text-6xl">
                WashU Move-In Tips: What Nobody Tells You About Moving
                Off-Campus
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
                    alt="WashU move-in tips"
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
                    You found your place. The hard part is supposed to be over.
                    Then move-in week hits, and a different set of problems
                    shows up.
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
                You found your place. The hard part is supposed to be over.
              </p>

              <p className="text-lg leading-8">
                Then move-in week hits, and a different set of problems shows
                up: no power in 100-degree heat, no WiFi for two weeks, a Target
                line out the door, and a scratch on the floor that your landlord
                swears you made, costing you thousands.
              </p>

              <p className="text-lg leading-8">
                Almost none of it is bad luck. It is stuff that quietly had a
                deadline a week or two ago that nobody told you about. Here is
                the list, in the order you should actually handle it, so moving
                in becomes easy and risk free.
              </p>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Two weeks out: the stuff with a deadline
                </h2>

                <p className="text-lg leading-8">
                  This is the section people skip and regret. Everything here
                  has a lead time. Handle it before you are standing in your new
                  place wondering why nothing works.
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Turn on your electricity before you arrive
                </h3>

                <p className="text-lg leading-8">
                  Electricity around WashU runs through Ameren Missouri, and it
                  does not switch on just because you signed a lease. If your
                  name is on the utilities and you never set up an account, you
                  can walk into your unit with no power.
                </p>

                <p className="text-lg leading-8">
                  I learned this hauling boxes up to my sister&apos;s place in
                  August. No AC, no working outlets, no light, in 100-degree St.
                  Louis heat. It is exactly as bad as it sounds.
                </p>

                <p className="text-lg leading-8">
                  Set up your Ameren account at least three business days before
                  move-in, online or by phone.
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Set up your gas too, it is a separate bill
                </h3>

                <p className="text-lg leading-8">
                  Gas is a different utility from electric, and many people
                  don’t realize it. If your heat, hot water, or stove runs on
                  gas, that runs through Spire, not Ameren. No Spire account
                  means no hot showers your first week.
                </p>

                <p className="text-lg leading-8">
                  Spire likes about a week of notice, even more lead time than
                  Ameren. While you are at it, read your lease and confirm
                  exactly which utilities are yours. It varies building to
                  building. Many properties leave you on the hook for gas,
                  electric, and internet.
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Order your WiFi install now, not move-in week
                </h3>

                <p className="text-lg leading-8">
                  If internet is not included in your lease, it is on you, and
                  you may not get to pick your provider depending on what is
                  already wired into the building. The two that cover most of
                  the WashU area are AT&amp;T Fiber and Spectrum.
                </p>

                <p className="text-lg leading-8">
                  Here is the part that catches people: a lot of setups need a
                  technician to come out, and those appointments book up weeks
                  ahead during move-in season. Call early. If you are handy and
                  your provider offers a self-install kit, grab that instead and
                  skip the wait.
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Ship your essentials ahead instead of waiting in the Target
                  line
                </h3>

                <p className="text-lg leading-8">
                  Move-in week, the Target by WashU turns into a zoo. The lines
                  are long, and the things everyone needs at once (command
                  strips, storage bins, shower caddies, basic kitchen gear) sell
                  out fast.
                </p>

                <p className="text-lg leading-8">
                  You do not have to play that game. Order it from Amazon ahead
                  of time and ship it to where you will be. Send it to the hotel
                  your family is staying at, straight to your apartment, or to
                  campus, so it is waiting for you when you get there. It saves
                  you a full day of shopping and the risk of essentials selling
                  out. This seems obvious, but almost nobody does it.
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Buy renters insurance before you sign
                </h3>

                <p className="text-lg leading-8">
                  Many off-campus leases require renters insurance, and the ones
                  that do usually want proof before they hand over your keys.
                  Your landlord&apos;s policy covers the building, not your
                  stuff, so this is what protects your laptop, your bike, and
                  you if someone gets hurt in your place.
                </p>

                <p className="text-lg leading-8">
                  It is cheap, usually ten to twenty dollars a month, and takes
                  about ten minutes to set up.
                </p>

                <p className="text-lg leading-8">
                  <strong>If you are a grad student</strong>, you are probably
                  past the age where your parents&apos; home insurance covers
                  you, so this is likely the only thing standing between you and
                  replacing everything out of pocket.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Move-in day
                </h2>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Document the unit IMMEDIATELY
                </h3>

                <p className="text-lg leading-8">
                  This is the one that could save you from thousands of dollars
                  in undeserved charges. Before you move anything in, walk the
                  whole unit with your phone and take photos and videos of every
                  room. Get the scuffs, the stains, the chipped counter, the
                  carpet, the appliances. Timestamp it, and send it to your
                  landlord that same day.
                </p>

                <p className="text-lg leading-8">
                  Here is why it matters: damage that was there before you
                  arrived becomes your problem at move-out unless you can prove
                  it was not you. That is how students lose their security
                  deposits and get hit with repair bills they never earned, and
                  it costs people thousands of dollars every year. Ten minutes
                  of filming is the cheapest insurance you will ever buy.
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Have your keys and access figured out before you arrive
                </h3>

                <p className="text-lg leading-8">
                  Sort the boring logistics like who hands you the keys, what
                  time, and who you call if something goes wrong after hours.
                  Ask about any fobs, gate codes, or door codes also. Showing up
                  after the leasing office has closed, with everything you own
                  in the back seat and no way in, is a rough way to start.
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Pack a first-night box you don&apos;t have to dig for
                </h3>

                <p className="text-lg leading-8">
                  When you finally get to campus, you want to drop your stuff
                  and go. Returning students want to see their friends again,
                  and if you are new to WashU, you likely want to get out there
                  and start meeting people. Nobody wants to spend that first
                  night tearing open boxes at 11pm hunting for your toothbrush.
                </p>

                <p className="text-lg leading-8">
                  If this sounds like you, pack one box or bag with the
                  first-night essentials and keep it on you, not buried your
                  luggage/moving boxes.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-5">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Your first week
                </h2>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Set up mail forwarding and lock down where packages land
                </h3>

                <p className="text-lg leading-8">
                  Set up USPS mail forwarding from your old address, and update
                  your address with your bank, Amazon, and the school. It takes
                  a few minutes and saves you from chasing down mail later.
                </p>

                <p className="text-lg leading-8">
                  Then figure out where your packages actually go. A package
                  room or locker is great. “Left at the front door” of a busy
                  building means your stuff is a target. Know the setup before
                  you start ordering everything for the new place.
                </p>

                <h3 className="text-2xl font-bold tracking-tight text-gray-950">
                  Sort roommate bills before the first one hits
                </h3>

                <p className="text-lg leading-8">
                  If you have roommates, get ahead of two things. First, who
                  brings what, so you do not end up with three microwaves and no
                  vacuum. Second, whose name the shared utilities go under and
                  how you split the bills (if applicable).
                </p>
              </section>

              <section className="space-y-4 rounded-3xl border border-gray-200 bg-gray-50 p-6">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  The quick version
                </h2>

                <p className="text-lg leading-8">
                  If you do nothing else, do these:
                </p>

                <ul className="space-y-3 text-lg leading-8">
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      Set up Ameren (electric) at least three business days out,
                      and Spire (gas) a week out
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      Book your WiFi install early, or grab a self-install kit
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      Get renters insurance if your lease asks for it, and have
                      proof ready for key handoff
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-3 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                    <span>
                      Film the whole unit before you unpack, and send it to your
                      landlord the same day
                    </span>
                  </li>
                </ul>
              </section>

              <section className="space-y-4 border-t border-gray-200 pt-8">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950">
                  Find the place first, worry about move-in later
                </h2>

                <p className="text-lg leading-8">
                  Move-in goes a lot smoother when you actually like the place
                  you&apos;re moving into. Proximity helps students find
                  off-campus housing fast, with honest peer reviews and
                  recommendations built around your preferences. Get your free
                  match at{" "}
                  <Link
                    href="/matchmaking"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    useproximity.org/matchmaking
                  </Link>
                  .
                </p>

                <p className="text-lg leading-8">
                  Still earlier in the process? Start with our guide to{" "}
                  <Link
                    href="/guides/washu-off-campus-budget"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    how much rent to budget for off-campus housing near WashU
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/guides/four-types-washu-housing"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    the four types of off-campus housing near WashU
                  </Link>
                  , so you sign somewhere you will be glad to move into.
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
