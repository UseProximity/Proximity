"use client";

import Link from "next/link";
import { Search } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 px-4 py-5">
      <div className="flex items-center justify-between w-full">
        {/* Logo and Navigation - Far Left */}
        <div className="flex items-center space-x-16 pl-2">
          <Link href="/" className="flex items-center space-x-3">
            <div className="relative flex h-12 w-12 items-center justify-center">
              {/* Outer red circle */}
              <div className="h-12 w-12 rounded-full bg-red-600 flex items-center justify-center">
                {/* Inner white circle */}
                <div className="h-4 w-4 rounded-full bg-white"></div>
                {/* Target crosshairs */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-8 w-0.5 bg-white"></div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-8 h-0.5 bg-white"></div>
                </div>
              </div>
            </div>
            <span className="text-lg font-bold text-gray-900">Proximity</span>
          </Link>

          {/* Navigation - Bigger gap from logo */}
          <nav className="flex items-center space-x-8 text-base md:text-sm lg:text-base font-medium">
            <Link
              href="/browse"
              className="text-base text-gray-700 hover:text-gray-900 font-medium transition-colors"
            >
              Browse Listings
            </Link>
            <Link
              href="/reviews"
              className="text-base text-gray-700 hover:text-gray-900 font-medium transition-colors"
            >
              Student Reviews
            </Link>
            <Link
              href="/heatmaps"
              className="text-base text-gray-700 hover:text-gray-900 font-medium transition-colors"
            >
              Heatmaps
            </Link>
            <Link
              href="/add-listing"
              className="text-base text-gray-700 hover:text-gray-900 font-medium transition-colors"
            >
              Add a Listing
            </Link>
          </nav>
        </div>

        {/* Search and Auth - Right Side */}
        <div className="flex items-center space-x-8 pr-2">
          <div className="relative hidden md:block">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              name="q"
              placeholder="Address, Neighborhood, Amenities"
              className="w-[340px] pl-10 h-10 text-base bg-gray-50 border-gray-200 focus:bg-white transition-colors placeholder:text-base font-[Rubik,sans-serif] placeholder:font-[Rubik,sans-serif]"
              autoComplete="off"
              style={{
                fontFamily: "Rubik, ui-sans-serif, system-ui, sans-serif",
                fontSize: "1rem",
              }}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
