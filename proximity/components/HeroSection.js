"use client";
import Link from "next/link";
import { Search } from "lucide-react";

export function HeroSection() {
  // Typing animation for search bar placeholder
  const phrases = [
    "Read honest WashU student reviews",
    "Browse heatmaps for best locations",
    "Avoid bad landlords",
    "See what's popular around campus",
  ];
  const fallbackPlaceholder = "Search address, neighborhood, amenities";

  return (
    <section
      className="w-full py-16 md:py-24"
      style={{
        backgroundColor: "#fcfcfc",
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='0' y='0' width='16' height='16' fill='white'/%3E%3Cpath d='M16 0V16M0 0H16' stroke='%23000000' stroke-opacity='0.09' stroke-width='1'/%3E%3C/svg%3E\")",
        backgroundSize: "16px 16px",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="mx-auto max-w-7xl">
        <div
          className="relative flex flex-col lg:flex-row w-full min-h-[500px]"
          style={{ height: "100%" }}
        >
          {/* Left Content */}
          <div className="pl-0 md:pl-8 lg:pl-20 pt-0 pb-4 space-y-6 lg:mt-0 lg:pt-0 flex flex-col justify-start items-start z-10 w-full lg:w-1/2">
            <div className="space-y-2">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight">
                Find Your Perfect
              </h1>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-red-600 leading-tight">
                WashU Housing
              </h2>
              <p className="text-lg md:text-xl text-gray-600 leading-relaxed">
                The first centralized platform for{" "}
                <span className="font-semibold">WashU</span> students to
                discover, review, and secure off-campus housing with confidence.
              </p>
            </div>
            {/* Minimalist Search Bar */}
            <form className="w-full flex items-center justify-end py-4">
              <div className="relative w-full max-w-2xl">
                <input
                  type="text"
                  className="w-full rounded-xl border border-gray-300 px-8 py-5 text-lg font-semibold text-gray-900 shadow focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all pr-16 placeholder:text-lg placeholder:font-normal"
                  autoComplete="off"
                  style={{
                    fontFamily: "Rubik, ui-sans-serif, system-ui, sans-serif",
                  }}
                />
                <button
                  type="submit"
                  className="absolute right-5 top-1/2 -translate-y-1/2 p-3 text-gray-500 hover:text-red-600 focus:outline-none"
                >
                  <Search className="h-7 w-7" />
                </button>
              </div>
            </form>
            {/* Stats */}
            <div className="flex space-x-10 mt-2 justify-end">
              <div>
                <div className="text-2xl font-bold text-red-600">20k+</div>
                <div className="text-base text-gray-600">renters</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">10k+</div>
                <div className="text-base text-gray-600">properties</div>
              </div>
            </div>
            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4 justify-end">
              <Link href="/browse">
                <button className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 text-base font-medium w-full sm:w-auto h-12">
                  Explore the Map →
                </button>
              </Link>
              <Link href="/reviews">
                <button
                  variant="outline"
                  className="border-red-600 text-red-600 hover:bg-red-50 px-6 py-3 text-base font-medium bg-transparent w-full sm:w-auto h-12"
                >
                  See Reviews →
                </button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
