"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import Footer from "@/components/layout/Footer";
import { ArrowRight, Clock3, Search, Send } from "lucide-react";

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

export default function GuidesPage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const resultsRef = useRef(null);

  const featuredGuide = guides[0];

  const filteredGuides = useMemo(() => {
    const q = submittedQuery.trim().toLowerCase();
    if (!q) return guides;

    return guides.filter((guide) => {
      const haystack = [
        guide.title,
        guide.description,
        guide.author,
        guide.category,
        guide.summary,
        guide.body,
        guide.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [submittedQuery]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSubmittedQuery(query);
  };

  useEffect(() => {
    if (submittedQuery && resultsRef.current) {
      resultsRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [submittedQuery]);

  return (
    <main className="min-h-screen bg-white text-gray-900">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-gray-200">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(244,63,94,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(251,113,133,0.10),transparent_28%),linear-gradient(180deg,#ffffff_0%,#fff7f8_100%)]" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,23,42,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.7) 1px, transparent 1px)",
            backgroundSize: "34px 34px",
          }}
        />
        <div className="absolute -top-24 right-[-6rem] h-96 w-96 rounded-full bg-rose-200/45 blur-3xl" />
        <div className="absolute bottom-[-5rem] left-[-4rem] h-80 w-80 rounded-full bg-orange-100/60 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-6 py-14 lg:py-16">
          <div className="max-w-4xl">
            <h1 className="mt-5 text-4xl font-black tracking-tight text-gray-950 sm:text-5xl lg:text-6xl">
              Smart student housing decisions start with{" "}
              <span className="text-rose-600">Proximity</span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-600 sm:text-xl">
              The ultimate student housing guide, written by real WashU students
            </p>

            <form onSubmit={handleSearch} className="mt-10 max-w-2xl">
              <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.35)]">
                <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-2">
                  <div className="flex flex-1 items-center gap-3 px-2">
                    <Search className="shrink-0 text-gray-400" size={20} />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search guides, keywords, landlord questions, rent, utilities..."
                      className="w-full bg-transparent text-base text-gray-900 placeholder:text-gray-400 outline-none sm:text-lg"
                      aria-label="Search guides"
                    />
                  </div>

                  <button
                    type="submit"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-950 text-white transition hover:bg-black"
                    aria-label="Search"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </section>

      <div className="h-32 bg-gradient-to-b from-rose-50 to-white" />

      {/* Featured guide */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-rose-500">
            Featured guide
          </p>
        </div>

        <Link href={`/guides/${featuredGuide.slug}`} className="group block">
          <article className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-xl">
            <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
              <div className="p-8 md:p-10 lg:p-12">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="inline-flex items-center rounded-full bg-rose-50 px-3 py-1 font-semibold uppercase tracking-[0.18em] text-rose-600">
                    {featuredGuide.category}
                  </span>

                  <span className="flex items-center gap-1 text-gray-500">
                    <Clock3 size={14} />
                    {featuredGuide.readTime}
                  </span>
                </div>

                <h2 className="mt-5 max-w-2xl text-3xl font-bold tracking-tight text-gray-950 transition group-hover:text-rose-600 sm:text-4xl">
                  {featuredGuide.title}
                </h2>

                <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600 sm:text-lg">
                  {featuredGuide.summary}
                </p>

                <div className="mt-6 inline-flex items-center gap-2 font-semibold text-rose-600 transition group-hover:text-rose-700">
                  Read guide
                  <ArrowRight size={16} />
                </div>
              </div>

              <div className="relative min-h-[280px] border-t border-gray-200 lg:min-h-full lg:border-l lg:border-t-0">
                <Image
                  src={featuredGuide.image}
                  alt={featuredGuide.title}
                  fill
                  className="object-cover"
                  priority
                />
              </div>
            </div>
          </article>
        </Link>
      </section>

      {/* Results */}
      <section ref={resultsRef} className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-rose-500">
              Guides
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">
              {submittedQuery ? "Search results" : "Browse our guides"}
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <p className="text-sm text-gray-500">
              {filteredGuides.length} result
              {filteredGuides.length === 1 ? "" : "s"} found
            </p>

            {submittedQuery && (
              <button
                onClick={() => {
                  setQuery("");
                  setSubmittedQuery("");
                }}
                className="rounded-full bg-rose-50 px-3 py-1 text-sm font-medium text-rose-600 transition hover:bg-rose-100"
              >
                Clear search
              </button>
            )}
          </div>
        </div>

        {filteredGuides.length > 0 ? (
          <div className="space-y-5">
            {filteredGuides.map((guide) => (
              <Link
                key={guide.title}
                href={`/guides/${guide.slug}`}
                className="group block"
              >
                <article className="overflow-hidden rounded-[1.75rem] border border-gray-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
                  <div className="grid gap-0 md:grid-cols-[280px_1fr]">
                    <div className="relative min-h-[220px] md:min-h-full">
                      <Image
                        src={guide.image}
                        alt={guide.title}
                        fill
                        className="object-cover"
                      />
                    </div>

                    <div className="p-6 sm:p-7">
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="inline-flex items-center rounded-full bg-rose-50 px-3 py-1 font-semibold uppercase tracking-[0.18em] text-rose-600">
                          {guide.category}
                        </span>

                        <span className="flex items-center gap-1 text-gray-500">
                          <Clock3 size={14} />
                          {guide.readTime}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8">
                        <div className="max-w-3xl">
                          <h3 className="text-2xl font-bold tracking-tight text-gray-950 transition group-hover:text-rose-600">
                            {guide.title}
                          </h3>

                          <p className="mt-3 text-base leading-7 text-gray-600">
                            {guide.description}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-2 text-sm font-semibold text-gray-950 transition group-hover:text-rose-600">
                          Read article
                          <ArrowRight size={16} />
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-[1.75rem] border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
            <p className="text-lg font-semibold text-gray-900">
              No guides match that search.
            </p>
            <p className="mt-2 text-gray-600">
              Try terms like “lease”, “rent”, “utilities”, or “checklist”.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSubmittedQuery("");
              }}
              className="mt-6 inline-flex items-center justify-center rounded-2xl bg-gray-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-black"
            >
              Clear search
            </button>
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
