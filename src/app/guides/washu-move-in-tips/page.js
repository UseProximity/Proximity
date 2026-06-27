import Link from "next/link";
import Image from "next/image";
import { Clock3, Home } from "lucide-react";
import { guides } from "@/lib/guides";
import GuideCTA from "@/components/guides/GuideCTA";
import RelatedArticlesSidebar from "@/components/guides/RelatedArticlesSidebar";
import BackNav from "@/components/guides/BackNav";
import RelatedArticlesMobile from "@/components/guides/RelatedArticlesMobile";
import ScrollToTop from "@/components/guides/ScrollToTop";

export const metadata = {
  title: "WashU Move-In Tips: What Nobody Tells You | Proximity",
  description:
    "Moving off-campus near WashU? Set up Ameren and Spire early, book your WiFi install, and protect your deposit. The move-in tips no one tells you.",
};

const currentGuideSlug = "washu-move-in-tips";
const currentGuide = guides.find((guide) => guide.slug === currentGuideSlug);
const relatedGuides = guides.filter((guide) => guide.slug !== currentGuideSlug);

export default function Page() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
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
                Moving off-campus near WashU? Set up Ameren and Spire early,
                book your WiFi install, and protect your deposit. The move-in
                tips no one tells you.
              </p>

              <h1 className="mt-4 text-3xl font-black tracking-tight text-gray-950 sm:mt-6 sm:text-4xl lg:text-5xl xl:text-6xl">
                WashU Move-In Tips: What Nobody Tells You About Moving
                Off-Campus
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
                    alt="WashU move-in tips"
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

      {/* ── Body ── */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
          <article className="min-w-0">
            <div className="space-y-8 text-gray-800 sm:space-y-10">
              <p className="text-base leading-7 sm:text-lg sm:leading-8">
                You found your place. The hard part is supposed to be over.
              </p>

              <p className="text-base leading-7 sm:text-lg sm:leading-8">
                Then move-in week hits, and a different set of problems shows
                up: no power in 100-degree heat, no WiFi for two weeks, a Target
                line out the door, and a scratch on the floor that your landlord
                swears you made, costing you thousands.
              </p>

              <p className="text-base leading-7 sm:text-lg sm:leading-8">
                Almost none of it is bad luck. It is stuff that quietly had a
                deadline a week or two ago that nobody told you about. Here is
                the list, in the order you should actually handle it.
              </p>

              {/* Two weeks out */}
              <section className="space-y-6 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Two weeks out: the stuff with a deadline
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  This is the section people skip and regret. Everything here
                  has a lead time. Handle it before you are standing in your new
                  place wondering why nothing works.
                </p>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Turn on your electricity before you arrive
                  </h3>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Electricity around WashU runs through Ameren Missouri, and
                    it does not switch on just because you signed a lease. If
                    your name is on the utilities and you never set up an
                    account, you can walk into your unit with no power.
                  </p>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    I learned this hauling boxes up to my sister&apos;s place in
                    August. No AC, no working outlets, no light, in 100-degree
                    St. Louis heat. It is exactly as bad as it sounds.
                  </p>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Set up your Ameren account at least three business days
                    before move-in, online or by phone.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Set up your gas too, it is a separate bill
                  </h3>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Gas is a different utility from electric. If your heat, hot
                    water, or stove runs on gas, that runs through Spire, not
                    Ameren. No Spire account means no hot showers your first
                    week.
                  </p>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Spire likes about a week of notice. While you are at it,
                    read your lease and confirm exactly which utilities are
                    yours — it varies building to building.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Order your WiFi install now, not move-in week
                  </h3>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    If internet is not included in your lease, you may not get
                    to pick your provider depending on what is already wired
                    into the building. The two that cover most of the WashU area
                    are AT&amp;T Fiber and Spectrum.
                  </p>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    A lot of setups need a technician to come out, and those
                    appointments book up weeks ahead during move-in season. Call
                    early. If your provider offers a self-install kit, grab that
                    instead and skip the wait.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Ship your essentials ahead instead of waiting in the Target
                    line
                  </h3>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Move-in week, the Target by WashU turns into a zoo. The
                    things everyone needs at once — command strips, storage
                    bins, shower caddies, basic kitchen gear — sell out fast.
                  </p>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Order it from Amazon ahead of time and ship it to where you
                    will be. Send it to the hotel your family is staying at,
                    straight to your apartment, or to campus. It saves you a
                    full day of shopping. This seems obvious, but almost nobody
                    does it.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Buy renters insurance before you sign
                  </h3>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Many off-campus leases require renters insurance, and the
                    ones that do usually want proof before they hand over your
                    keys. Your landlord&apos;s policy covers the building, not
                    your stuff.
                  </p>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    It is cheap — usually ten to twenty dollars a month — and
                    takes about ten minutes to set up.{" "}
                    <strong>If you are a grad student</strong>, you are probably
                    past the age where your parents&apos; home insurance covers
                    you, so this is likely the only thing standing between you
                    and replacing everything out of pocket.
                  </p>
                </div>
              </section>

              {/* Move-in day */}
              <section className="space-y-6 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Move-in day
                </h2>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Document the unit IMMEDIATELY
                  </h3>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Before you move anything in, walk the whole unit with your
                    phone and take photos and videos of every room. Get the
                    scuffs, the stains, the chipped counter, the carpet, the
                    appliances. Timestamp it, and send it to your landlord that
                    same day.
                  </p>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Damage that was there before you arrived becomes your
                    problem at move-out unless you can prove it was not you.
                    That is how students lose their security deposits and get
                    hit with repair bills they never earned. Ten minutes of
                    filming is the cheapest insurance you will ever buy.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Have your keys and access figured out before you arrive
                  </h3>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Sort the logistics: who hands you the keys, what time, and
                    who you call if something goes wrong after hours. Ask about
                    any fobs, gate codes, or door codes. Showing up after the
                    leasing office has closed with no way in is a rough way to
                    start.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Pack a first-night box you don&apos;t have to dig for
                  </h3>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Nobody wants to spend that first night tearing open boxes at
                    11pm hunting for your toothbrush. Pack one box or bag with
                    the first-night essentials and keep it on you — not buried
                    in your luggage or moving boxes.
                  </p>
                </div>
              </section>

              {/* First week */}
              <section className="space-y-6 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Your first week
                </h2>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Set up mail forwarding and lock down where packages land
                  </h3>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    Set up USPS mail forwarding from your old address, and
                    update your address with your bank, Amazon, and the school.
                    Then figure out where your packages actually go. A package
                    room or locker is great — &quot;left at the front door&quot;
                    of a busy building means your stuff is a target.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Sort roommate bills before the first one hits
                  </h3>
                  <p className="text-base leading-7 sm:text-lg sm:leading-8">
                    If you have roommates, get ahead of two things: who brings
                    what (so you do not end up with three microwaves and no
                    vacuum), and whose name the shared utilities go under and
                    how you split the bills.
                  </p>
                </div>
              </section>

              {/* Quick version */}
              <section className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:rounded-3xl sm:p-6">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  The quick version
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  If you do nothing else, do these:
                </p>
                <ul className="space-y-3">
                  {[
                    "Set up Ameren (electric) at least three business days out, and Spire (gas) a week out",
                    "Book your WiFi install early, or grab a self-install kit",
                    "Get renters insurance if your lease asks for it, and have proof ready for key handoff",
                    "Film the whole unit before you unpack, and send it to your landlord the same day",
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
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Find the place first, worry about move-in later
                </h2>
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
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
                <p className="text-base leading-7 sm:text-lg sm:leading-8">
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
