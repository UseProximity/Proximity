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

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import AvailableListings from "@/components/listings/AvailableListings";
import TopFilterBar from "@/components/listings/TopFilterBar";
import { WASHU_PLACES, NON_CAMPUS_WALK_PLACES } from "@/utils/washuPlaces";
import { useFavorites } from "@/context/FavoritesContext";
import {
  DEFAULT_FILTERS,
  filterListings,
  filtersActive,
  fittingRents,
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
  // Desktop only: hide the map and show the listings as a wider grid.
  const [mapHidden, setMapHidden] = useState(false);
  /*
   * The fade-through of a toggle (see AvailableListings) marks <body> with
   * data-map-switching, and AvailableListings removes it once the new layout is
   * in place. That removal follows a change of mapHidden, which two toggles in
   * quick succession can cancel out, leaving the map offset and the column
   * faded. So the mark is also removed here, after a safety timeout and on
   * unmount. Every toggle still flips mapHidden, so two quick toggles are two
   * flips; only the safety timer restarts.
   */
  const switchTimers = useRef({});
  const endMapSwitch = () =>
    document.body.removeAttribute("data-map-switching");
  const toggleMap = () => {
    const timers = switchTimers.current;
    clearTimeout(timers.safety);
    cancelAnimationFrame(timers.frame);
    document.body.setAttribute("data-map-switching", "");
    timers.flip = setTimeout(() => setMapHidden((hidden) => !hidden), 120);
    // Two frames, like AvailableListings: the new layout has been drawn, still
    // invisible, before the mark goes and its width change can animate.
    timers.safety = setTimeout(() => {
      timers.frame = requestAnimationFrame(() =>
        requestAnimationFrame(endMapSwitch)
      );
    }, 700);
  };
  useEffect(() => {
    const timers = switchTimers.current;
    return () => {
      clearTimeout(timers.flip);
      clearTimeout(timers.safety);
      cancelAnimationFrame(timers.frame);
      endMapSwitch();
    };
  }, []);
  // "Suggested for you" ids, best first (0, 2 or 4). Fetched once per visit, so
  // a listing contacted from the strip stays put until the next reload.
  const [suggestedIds, setSuggestedIds] = useState([]);
  const [suggestedMode, setSuggestedMode] = useState("suggested");
  const [anchorLabel, setAnchorLabel] = useState(null);
  const userId = session?.user?.id;
  /*
   * The chat's no-reply note links here as ?from=no-reply&similar=<id>, which
   * asks for places similar to the listing that went unanswered (Wyatt,
   * 2026-10-16). Not ?listing=, which opens that listing's panel. The API
   * falls back to normal suggestions when it can't.
   */
  const similarTo = searchParams.get("similar");

  useEffect(() => {
    if (!userId && !similarTo) return;
    const url = similarTo
      ? `/api/listings/suggested?similar=${encodeURIComponent(similarTo)}`
      : "/api/listings/suggested";
    fetch(url)
      .then((r) => (r.ok ? r.json() : { ids: [] }))
      .then((data) => {
        setSuggestedIds(Array.isArray(data?.ids) ? data.ids : []);
        setSuggestedMode(data?.mode === "similar" ? "similar" : "suggested");
        setAnchorLabel(typeof data?.anchorLabel === "string" ? data.anchorLabel : null);
      })
      .catch(() => {});
  }, [userId, similarTo]);

  /*
   * Saved filters feed the student's running filter summary (the lightest
   * suggestion signal). Called once when a filter control closes after a change
   * (the Price and Beds & Baths cards and the side panel on desktop, which
   * filter live) and from the Apply button of the phone's filter drawer, never
   * on every slider tick. Fire-and-forget.
   */
  const handleFiltersSaved = (saved) => {
    if (!userId) return;
    fetch("/api/filter-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters: saved }),
    }).catch(() => {});
  };

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

  // For the price histograms: the rents of the available listings that fit
  // the given filters (the page's, or a filter control's unapplied ones).
  const rentsFor = useCallback(
    (forFilters) =>
      fittingRents(listings, { filters: forFilters, search, savedIds, campusMinutes }),
    [listings, search, savedIds] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The suggested strip only shows on the unfiltered view: once a student
  // narrows the list, their own question is the ranking.
  const suggestedListings = useMemo(() => {
    if (search.trim() || filtersActive(filters)) return [];
    const byId = new Map(listings.map((l) => [String(l._id), l]));
    const found = suggestedIds.map((id) => byId.get(String(id))).filter(Boolean);
    // Keep the count even if a suggested listing dropped out of the feed.
    return found.slice(0, found.length - (found.length % 2));
  }, [listings, suggestedIds, search, filters]);

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
          rentsFor={rentsFor}
          filters={filters}
          setFilters={setFilters}
          onReset={handleReset}
          onFiltersSaved={handleFiltersSaved}
          mapHidden={mapHidden}
          // A fade-through: fade out now, and switch the layout once that has
          // finished, while it is invisible.
          onToggleMap={toggleMap}
        />
      </div>
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
        <AvailableListings
          session={session}
          listings={filteredListings}
          suggestedListings={suggestedListings}
          suggestedMode={suggestedMode}
          suggestedLabel={
            suggestedMode === "similar" && anchorLabel ? `Similar to ${anchorLabel}` : "Suggested for you"
          }
          rentsFor={rentsFor}
          onFiltersSaved={handleFiltersSaved}
          mapHidden={mapHidden}
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
