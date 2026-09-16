/*
 * Main orchestrator for the /browse page. Fetches all listings from /api/listings once on
 * mount, then applies a rich filter set entirely client-side for instant feedback without
 * round-trips. Manages the full filter state (rent range, bed/bath counts, walk times,
 * move-in date, home type, lease structure, amenities, utilities, sublease flag, and
 * saved-only toggle) as well as a free-text search across address and description fields.
 * The matching itself lives in lib/listings/filterListings.js, which evaluates each
 * listing unit-by-unit and lease-by-lease rather than against listing-level aggregates.
 * Reads an initial ?search= query param from the URL so the Header's search bar can
 * deep-link into a pre-filtered browse view. Passes the filtered listing array down to
 * AvailableListings (the split map+list panel) and TopFilterBar (the filter UI). Uses
 * FavoritesContext to support the saved-only filter without an extra API call.
 */
"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import AvailableListings from "@/components/listings/AvailableListings";
import TopFilterBar from "@/components/listings/TopFilterBar";
import { WASHU_PLACES, NON_CAMPUS_WALK_PLACES } from "@/utils/washuPlaces";
import { useFavorites } from "@/context/FavoritesContext";
import {
  DEFAULT_FILTERS,
  filterListings,
} from "@/lib/listings/filterListings";


export default function BrowseContent({ session, initialListings = null }) {
  const { savedIds } = useFavorites();
  // Seeded server-side so crawlers and first paint get real cards; the mount
  // fetch below still runs as a freshness refresh over the 5-min server cache.
  const [listings, setListings] = useState(initialListings ?? []);
  const [loading, setLoading] = useState(
    !(initialListings && initialListings.length)
  );
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("search");

  const [search, setSearch] = useState(searchQuery || "");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  useEffect(() => {
    const fetchListings = async () => {
      try {
        const response = await fetch("/api/listings");
        const data = await response.json();
        if (Array.isArray(data)) setListings(data);
      } catch (error) {
        console.error("Error fetching listings:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchListings();
  }, []);

  // Lock body scroll to prevent page dragging
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalHeight = document.body.style.height;

    document.body.style.overflow = "hidden";
    document.body.style.height = "100dvh";

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.height = originalHeight;
    };
  }, []);

  const handleClearSearch = () => {
    const url = new URL(window.location);
    url.searchParams.delete("search");
    window.history.replaceState({}, "", url);
  };

  const handleReset = () => {
    setSearch("");
    setFilters(DEFAULT_FILTERS);
    handleClearSearch();
  };

  /*
   * Minimum walk time to campus — the same place set the /washu pages use
   * (grocery + Med Campus excluded via NON_CAMPUS_WALK_PLACES). Injected into
   * the filter module so it stays free of WashU-specific geography.
   */
  const campusMinutes = (listing) => {
    const pwm = listing.placeWalkMinutes;
    const mins = WASHU_PLACES.filter(
      (p) => !NON_CAMPUS_WALK_PLACES.includes(p.name)
    )
      .map((p) => pwm?.[p.name])
      .filter((m) => m != null);
    return mins.length ? Math.min(...mins) : null;
  };

  const filteredListings = useMemo(
    () => filterListings(listings, { filters, search, savedIds, campusMinutes }),
    [listings, search, filters, savedIds] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading listings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 flex flex-col h-[calc(100dvh-83px)] md:h-[calc(100dvh-104px)]">
      <div className="hidden md:block">
        <TopFilterBar
          search={search}
          setSearch={setSearch}
          filters={filters}
          setFilters={setFilters}
          onReset={handleReset}
        />
      </div>
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
        <AvailableListings
          session={session}
          listings={filteredListings}
          filters={filters}
          setFilters={setFilters}
          handleReset={handleReset}
          onClearSearch={handleClearSearch}
          search={search}
          setSearch={setSearch}
        />
      </div>
    </div>
  );
}
