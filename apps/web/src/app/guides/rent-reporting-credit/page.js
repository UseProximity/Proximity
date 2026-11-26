import Link from "next/link";
import Image from "next/image";
import { Clock3, Home } from "lucide-react";
import { guides } from "@/lib/guides";
import GuideCTA from "@/components/guides/GuideCTA";
import RelatedArticlesSidebar from "@/components/guides/RelatedArticlesSidebar";
import BackNav from "@/components/guides/BackNav";
import RelatedArticlesMobile from "@/components/guides/RelatedArticlesMobile";
import ScrollToTop from "@/components/guides/ScrollToTop";
import GuideJsonLd from "@/components/guides/GuideJsonLd";

export const metadata = {
  title: "Rent Payments Can Build Your Credit. What Students Should Know",
  description:
    "Your rent payments could be building your credit and most students don't know it. Here's how rent reporting works, whether it actually moves your score, and how to do it for free.",
};

const currentGuideSlug = "rent-reporting-credit";
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
                Rent is the biggest bill most students pay, and for almost all
                of them it is completely invisible on their credit report.
                Here is the honest version of how rent reporting works.
              </p>

              <h1 className="mt-4 text-3xl font-black tracking-tight text-gray-950 sm:mt-6 sm:text-4xl lg:text-5xl xl:text-6xl">
                Rent Payments Can Build Your Credit. What Students Should Know
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
                    alt="Rent reporting and credit building"
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
                    You pay $800 on the first of the month. It clears. And as
                    far as any bank, landlord, or lender is concerned, it never
                    happened.
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
                You pay $800 on the first of the month. It clears. And as far
                as any bank, landlord, or lender is concerned, it never
                happened.
              </p>

              <p className="text-base leading-7 sm:text-lg sm:leading-8">
                Rent is the biggest bill most students pay, and for almost all
                of them it is completely invisible on their credit report.
                There is a way to change that, and almost nobody tells
                students about it.
              </p>

              <p className="text-base leading-7 sm:text-lg sm:leading-8">
                Here is the honest version.
              </p>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  What rent reporting actually is
                </h2>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  A rent reporting service watches for your rent payment each
                  month, confirms it went through, and sends that record to
                  the credit bureaus. Your rent then shows up on your credit
                  report the way a car payment or credit card payment would.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  That is the whole thing. You keep paying rent exactly the
                  way you already do.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Most services only report on-time payments, which means a
                  late month does not get held against you. Check that before
                  you sign up with anyone.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Does it actually work?
                </h2>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Mostly yes, but the size of the effect depends almost
                  entirely on what your credit looks like right now.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  The strongest evidence comes from the Urban Institute, which
                  ran the first randomized controlled trial of rent reporting
                  alongside Credit Builders Alliance, Esusu, and TransUnion.
                  Randomized means they compared people who reported their
                  rent against a similar group who did not, which is a much
                  better test than a company reporting on its own customers.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  What they found:
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>
                    Over one to two years, the numbers get specific.
                  </strong>{" "}
                  An Urban Institute analysis of about 12,500 people using
                  Esusu found that renters who started with no credit file or
                  a thin one ended up with average VantageScores around 676
                  after 12 months of on-time rent, and around 686 after 24
                  months. People who had no score at all typically ended up
                  scoreable, and those who started lowest gained the most.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>If you have a low score, it moves.</strong> Around
                  31 percent of participants who started in the subprime range
                  moved up to near-prime or better by the end of the study.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>
                    If you already have a solid credit file, expect much less.
                  </strong>{" "}
                  A Credit Builders Alliance pilot that isolated the effect of
                  just the rental tradeline found an average increase of about
                  23 points. Data from Bilt showed the biggest gains went to
                  people with scores below 540, with smaller effects for
                  everyone above that.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  One caveat on the study: it ran during a period of
                  pandemic-era rental assistance and eviction protections,
                  which the researchers note may have influenced results.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  The catch
                </h2>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Not every credit score counts rent.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  FICO 9 and VantageScore 4.0 include rental payment history
                  when it is reported. FICO 8 does not, and FICO 8 is still
                  the most widely used score by credit card issuers and auto
                  lenders. Mortgage lending runs on even older FICO versions
                  that also ignore rent.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  This is why the research above mostly uses VantageScore. It
                  counts rent, and it responds faster to new accounts.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  The practical consequence: you might watch a number go up in
                  an app and see no change when you apply for a car loan. That
                  is not the service failing. It is the lender using a scoring
                  model that does not look at rent.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  For someone with an established credit file, that makes rent
                  reporting a modest addition. For someone with no file at
                  all, it can still be the thing that gets you a score in the
                  first place, which matters regardless of which model a
                  lender uses.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  Who should actually do this
                </h2>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Worth it if you:
                  </h3>
                  <ul className="space-y-3">
                    {[
                      "Have never had a credit card in your own name",
                      "Are an international student building a US credit file from zero",
                      "Are paying rent without a cosigner",
                    ].map((item) => (
                      <li key={item} className="flex gap-3">
                        <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                        <span className="text-base leading-7 sm:text-lg sm:leading-8">
                          {item}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">
                    Probably skip it if you:
                  </h3>
                  <ul className="space-y-3">
                    {[
                      "Are an authorized user on a parent's credit card, which means you likely already have a file",
                      "Had a parent cosign or guarantee your lease",
                      "Already have a credit card, a score, and a year or two of history",
                    ].map((item) => (
                      <li key={item} className="flex gap-3">
                        <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                        <span className="text-base leading-7 sm:text-lg sm:leading-8">
                          {item}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  If you are not sure which describes you, check your credit
                  report first. Instructions below.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  How to do it for free
                </h2>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <a
                    href="https://www.self.inc/rent-and-bills-reporting"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    Self
                  </a>{" "}
                  offers free rent reporting to all three credit bureaus. No
                  cost, no credit check, no credit card required, and only
                  positive payments get reported. They also have paid upgrades
                  for utility and phone reporting and for backdating past
                  payments, but the core rent reporting is genuinely free.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  <strong>Proximity is not affiliated with Self.</strong> We
                  do not receive any payment, commission, or referral fee for
                  mentioning them, and we have no partnership or relationship
                  with the company. We are pointing you at the free option
                  because it is the free option.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Other services charge between roughly $3 and $10 a month,
                  usually with extra features like backdating past rent. If
                  free covers what you need, start there.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  If you split rent with roommates
                </h2>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Rent reporting services work by scanning your bank account
                  for the rent payment. That is simple if you pay the
                  landlord directly.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  It gets less obvious if you are one of four people in a
                  house and one roommate pays the landlord while everyone
                  else sends them money. Your bank sees a Venmo to a friend,
                  not a rent payment.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Self says its service can identify Venmo, Cash App, and
                  Zelle transfers along with debit card payments and bank
                  transfers, and that you choose which payment to report. So
                  there is a decent chance it works. Sign up, connect your
                  account, and check whether it finds the right transaction
                  before you assume.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  If it cannot find your payment, ask your landlord whether
                  their property management software offers rent reporting.
                  Some platforms let anyone named on the lease report, because
                  they work off the lease rather than your bank feed. That
                  usually costs the resident around $5 a month and costs the
                  landlord nothing.
                </p>
              </section>

              <section className="space-y-4 border-l-2 border-rose-200 pl-4 sm:pl-5">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  How to see where you stand
                </h2>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Go to{" "}
                  <a
                    href="https://www.annualcreditreport.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-rose-600 hover:underline"
                  >
                    annualcreditreport.com
                  </a>
                  . It is the only federally authorized site for free credit
                  reports, and you can pull yours from all three bureaus. The
                  Consumer Financial Protection Bureau describes getting that
                  report as the first step in building or rebuilding credit.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  If you are an international student who recently arrived,
                  there is a good chance nothing is there yet. That is normal,
                  and it is exactly the situation rent reporting is built for.
                  Note that you will generally need a Social Security number
                  or an ITIN before your rent can be matched to a credit file,
                  so sort that out first.
                </p>
              </section>

              <section className="space-y-4 border-t border-gray-200 pt-6 sm:pt-8">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                  The bottom line
                </h2>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Rent reporting is one of the few credit-building tools that
                  does not require taking on debt.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  It is still uncommon. As of 2024, only about 3.5 percent of
                  renters nationwide had any rental payment history in their
                  credit file, though that share has been climbing quickly.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  If you have no credit history, this is one of the
                  highest-value free things you can do this year. If you
                  already have a card and a score, it is a small nice-to-have
                  and not worth paying for.
                </p>

                <p className="text-base leading-7 sm:text-lg sm:leading-8">
                  Either way, you should know it exists. Most students do not.
                </p>

                <p className="text-sm italic leading-6 text-gray-600 sm:text-base sm:leading-7">
                  Proximity earns nothing from this guide. No affiliate
                  links, no partnerships, no referral fees.
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
