"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock3, Search, Send } from "lucide-react";
import GuidesCarousel from "@/components/guides/GuidesCarousel";
import { guides } from "@/lib/guides";

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
                      placeholder="Search guides, topics, or keywords..."
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
      {/* Featured guide */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-rose-500">
            Featured guide
          </p>
        </div>

        {/* Mobile */}
        <Link
          href={`/guides/${featuredGuide.slug}`}
          className="group block lg:hidden"
        >
          <article className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm transition duration-200 hover:shadow-xl">
            <div className="relative aspect-[16/9]">
              <Image
                src={featuredGuide.image}
                alt={featuredGuide.title}
                fill
                className="object-cover"
                priority
              />
            </div>

            <div className="p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 font-semibold uppercase tracking-[0.16em] text-rose-600">
                  {featuredGuide.category}
                </span>

                <span className="flex items-center gap-1 text-gray-500">
                  <Clock3 size={14} />
                  {featuredGuide.readTime}
                </span>
              </div>

              <h2 className="mt-3 text-2xl font-bold tracking-tight text-gray-950 transition group-hover:text-rose-600">
                {featuredGuide.title}
              </h2>

              <p className="mt-3 hidden text-sm leading-6 text-gray-600 sm:block">
                {featuredGuide.summary}
              </p>

              <div className="mt-4 inline-flex items-center gap-2 font-semibold text-rose-600 transition group-hover:text-rose-700">
                Read guide
                <ArrowRight size={16} />
              </div>
            </div>
          </article>
        </Link>

        {/* Desktop */}
        <Link
          href={`/guides/${featuredGuide.slug}`}
          className="group hidden lg:block"
        >
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
          <GuidesCarousel guides={filteredGuides} />
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
    </main>
  );
}
