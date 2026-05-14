"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import dynamic from "next/dynamic";

import MapPopupCard, { ListingCard, MobileMapPopup } from "@/components/listings/MapPopupCard";
import ListDetailPanel from "@/components/listings/ListDetailPanel";
import {
  getAreaRangeLabel,
  getRentRangeLabel,
  getUnitValuesLabel,
} from "@/utils/listingFormatters";
import {
  SLIDER_CSS,
  FilterSection,
  DualRangeSlider,
  StepSlider,
  DualStepSlider,
  BED_STEPS,
  BATH_STEPS,
  DIST_STEPS,
  SHTT_STEPS,
} from "@/components/listings/FilterComponents";

const MapView = dynamic(() => import("@/components/listings/MapView"), { ssr: false });

export default function AvailableListings({
  session,
  listings,
  filters,
  setFilters,
  handleReset,
  onClearSearch,
  search,
  setSearch,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Track viewport so only the visible map instance is "active"
  // Default to desktop during SSR to avoid hydration mismatch
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  useEffect(() => {
    // Keep in sync with CSS breakpoint used by the layout
    const media = window.matchMedia("(min-width: 768px)");
    const handleChange = () => setIsDesktop(media.matches);
    // Initialize immediately on mount
    handleChange();
    if (media.addEventListener) {
      media.addEventListener("change", handleChange);
    } else {
      media.addListener(handleChange);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", handleChange);
      } else {
        media.removeListener(handleChange);
      }
    };
  }, []);

  const rawLat = parseFloat(searchParams.get("lat"));
  const rawLng = parseFloat(searchParams.get("lng"));
  const searchLocation =
    !isNaN(rawLat) && !isNaN(rawLng) ? { lat: rawLat, lng: rawLng } : null;

  /* ── Map overlay card state ── */
  const [selectedListing, setSelectedListing] = useState(null);

  /* ── Left panel expanded listing ── */
  const panelId = searchParams.get("panel");
  const [expandedListing, setExpandedListing] = useState(null);
  const panelRef = useRef(null);
  const listingsInitialized = useRef(false);

  // Sync local state from URL — handles direct links, back/forward, and page reload
  useEffect(() => {
    if (!panelId) {
      setExpandedListing(null);
      return;
    }
    // Already showing this listing — don't re-fetch
    if (expandedListing && String(expandedListing._id) === panelId) return;
    // Try listings array first for instant render, then always fetch full detail
    const match = listings.find((l) => String(l._id) === panelId);
    if (match) setExpandedListing(match);
    fetch(`/api/listing/${panelId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setExpandedListing(data); })
      .catch(() => {});
  }, [panelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPanel = (listing) => {
    setExpandedListing(listing); // immediate UI with browse data
    const params = new URLSearchParams(searchParams.toString());
    params.set("panel", listing._id);
    router.push(`/browse?${params.toString()}`);
    // Fetch full detail (unit_leases for rent, review IDs for voting)
    fetch(`/api/listing/${listing._id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setExpandedListing(data); })
      .catch(() => {});
  };

  const closePanel = () => {
    setExpandedListing(null); // immediate UI
    const params = new URLSearchParams(searchParams.toString());
    params.delete("panel");
    const qs = params.toString();
    router.push(`/browse${qs ? `?${qs}` : ""}`);
  };

  // Scroll panel to top whenever a listing is expanded
  useEffect(() => {
    if (expandedListing && panelRef.current) {
      panelRef.current.scrollTop = 0;
    }
  }, [expandedListing]);

  // Scroll panel to the selected listing card when a pin is clicked (centered)
  useEffect(() => {
    if (!selectedListing || expandedListing || !panelRef.current) return;
    const card = panelRef.current.querySelector(
      `[data-listing-id="${selectedListing._id}"]`
    );
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedListing]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Viewport / "Browse this area" filter ── */
  const [viewportBounds, setViewportBounds] = useState(null);

  const handleBrowseArea = (bounds) => {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    setViewportBounds({ swLat: sw.lat, swLng: sw.lng, neLat: ne.lat, neLng: ne.lng });
  };

  const visibleListings = useMemo(() => {
    const filtered = !viewportBounds
      ? listings
      : listings.filter(
          (l) =>
            l.latitude != null &&
            l.longitude != null &&
            l.latitude >= viewportBounds.swLat &&
            l.latitude <= viewportBounds.neLat &&
            l.longitude >= viewportBounds.swLng &&
            l.longitude <= viewportBounds.neLng
        );
    return [...filtered].sort((a, b) => (a.unavailable ? 1 : 0) - (b.unavailable ? 1 : 0));
  }, [listings, viewportBounds]);

  /* ── Mobile UI state ── */
  const [mobileView, setMobileView] = useState(() => {
    if (typeof window === "undefined") return "map";
    return new URLSearchParams(window.location.search).get("view") === "listings" ? "listings" : "map";
  });

  // Sync mobileView when URL changes (back/forward navigation)
  useEffect(() => {
    const v = searchParams.get("view");
    setMobileView(v === "listings" ? "listings" : "map");
  }, [searchParams]);

  const switchMobileView = (view) => {
    setMobileView(view);
    if (view === "listings") setSelectedListing(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    router.push(`/browse?${params.toString()}`);
  };

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileDraft, setMobileDraft] = useState(filters);

  // Sync mobileDraft when filter panel opens
  useEffect(() => {
    if (mobileFiltersOpen) setMobileDraft(filters);
  }, [mobileFiltersOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear map overlay card and panel when listings data changes (filter/search).
  // Skips until the initial data load has settled (empty → real data) so that
  // direct ?panel= links are not wiped on first render.
  useEffect(() => {
    if (!listingsInitialized.current) {
      // Wait until we see actual data, then mark initialized on the NEXT change
      if (listings.length > 0) listingsInitialized.current = true;
      return;
    }
    setSelectedListing(null);
    setExpandedListing(null);
    if (panelId) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("panel");
      const qs = params.toString();
      router.replace(`/browse${qs ? `?${qs}` : ""}`);
    }
  }, [listings]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePinClose = () => {
    setSelectedListing(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lat");
    params.delete("lng");
    params.delete("panel");
    const qs = params.toString();
    router.replace("/browse" + (qs ? "?" + qs : ""));
  };

  const handleListingClick = (listingId) => {
    if (!listingId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("listing", listingId);
    router.push(`/browse?${params.toString()}`);
  };

  const toggleMobileArray = (field, value) => {
    const arr = mobileDraft[field] || [];
    setMobileDraft({
      ...mobileDraft,
      [field]: arr.includes(value)
        ? arr.filter((v) => v !== value)
        : [...arr, value],
    });
  };

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
        <svg
          className="w-12 h-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
      </div>
      <h3 className="text-2xl font-bold text-gray-900 mb-3">
        No listings found
      </h3>
      <p className="text-gray-600 mb-6 max-w-md leading-relaxed">
        We couldn&apos;t find any listings matching your criteria. Try adjusting
        your filters or search terms.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleReset}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors duration-200 shadow-lg hover:shadow-xl"
        >
          Clear all filters
        </button>
        {onClearSearch && (
          <button
            onClick={onClearSearch}
            className="px-6 py-3 bg-white hover:bg-gray-50 text-red-600 border-2 border-red-600 hover:border-red-700 font-semibold rounded-xl transition-colors duration-200 shadow-lg hover:shadow-xl"
          >
            Clear search
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* ── Desktop listing panel ── */}
      <div
        ref={panelRef}
        className={`hidden md:block shrink-0 overflow-y-auto transition-[width] duration-300 ${expandedListing ? "w-[65vw]" : "w-[40vw] px-4 py-4"}`}
        style={{ height: "100%", minHeight: 0 }}
      >
        <AnimatePresence initial={false} mode="wait">
          {expandedListing ? (
            <motion.div key={`detail-${expandedListing._id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <ListDetailPanel
                listing={expandedListing}
                onBack={() => {
                  setSelectedListing(null);
                  closePanel();
                }}
              />
            </motion.div>
          ) : (
            <motion.div key="grid" exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <div className="flex items-center gap-2 px-1 mb-4">
                <p className="text-sm font-semibold text-gray-500">
                  {visibleListings.length}{" "}
                  {viewportBounds ? "listings in this area" : "Listings Found"}
                </p>
                {viewportBounds && (
                  <button
                    onClick={() => setViewportBounds(null)}
                    className="text-xs text-red-600 hover:text-red-700 font-medium"
                  >
                    Show all
                  </button>
                )}
              </div>

              {visibleListings.length === 0 ? (
                emptyState
              ) : (
                <div className="grid grid-cols-2 gap-6">
                  {visibleListings.map((listing) => (
                    <div key={listing._id} data-listing-id={listing._id}>
                      <ListingCard
                        listing={listing}
                        session={session}
                        isSelected={selectedListing?._id === listing._id}
                        onCardClick={() => {
                          setSelectedListing(listing);
                          openPanel(listing);
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Desktop map ── */}
      <div
        className="hidden md:flex flex-1 w-full relative"
        style={{ position: "sticky", top: 0, height: "100%", minHeight: 0 }}
      >
        <MapView
          listings={listings}
          filters={filters}
          setFilters={setFilters}
          handleReset={handleReset}
          onListingSelect={(listing) => {
            setSelectedListing(listing);
            closePanel();
          }}
          selectedListingId={expandedListing?._id || selectedListing?._id}
          searchLocation={searchLocation}
          isActive={isDesktop}
          onBrowseArea={handleBrowseArea}
          panelExpanded={!!expandedListing}
        />
        {selectedListing && !expandedListing && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-72 pointer-events-auto">
            <MapPopupCard
              listing={selectedListing}
              session={session}
              onClose={handlePinClose}
              onCardClick={() => {
                openPanel(selectedListing);
              }}
            />
          </div>
        )}
      </div>

      {/* ── Mobile layout ── */}
      <div className="md:hidden flex flex-col w-full" style={{ height: "100%" }}>
        {/* Content area: map or listings */}
        <div className="flex-1 relative overflow-hidden min-h-0">

          {/* MAP VIEW */}
          {mobileView === "map" && (
            <>
              <MapView
                listings={listings}
                filters={filters}
                setFilters={setFilters}
                handleReset={handleReset}
                onListingSelect={(listing) => {
                  setSelectedListing(listing);
                }}
                selectedListingId={selectedListing?._id}
                searchLocation={searchLocation}
                isActive={!isDesktop}
                onBrowseArea={handleBrowseArea}
              />

              {/* Minimal pin popup */}
              {selectedListing && (
                <div className="absolute bottom-4 left-4 right-4 z-10 pointer-events-auto">
                  <MobileMapPopup
                    listing={selectedListing}
                    onClose={handlePinClose}
                    onViewListing={() =>
                      router.push(`/listings/${selectedListing._id}?from=map`)
                    }
                  />
                </div>
              )}

              {/* Filter / saved buttons */}
              <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                <button
                  onClick={() => setMobileFiltersOpen(true)}
                  className="bg-white rounded-full p-3 shadow-lg border border-gray-200 active:bg-gray-50"
                  aria-label="Open filters"
                >
                  <img
                    src="/assets/filter-icon.svg"
                    alt=""
                    className="w-5 h-5"
                    style={{ filter: "brightness(0) opacity(0.7)" }}
                  />
                </button>
                <button
                  onClick={() =>
                    setFilters({ ...filters, savedOnly: !filters.savedOnly })
                  }
                  className={`rounded-full p-3 shadow-lg border active:opacity-80 transition-colors ${
                    filters.savedOnly
                      ? "bg-red-500 border-red-500"
                      : "bg-white border-gray-200"
                  }`}
                  aria-label={
                    filters.savedOnly ? "Show all listings" : "Show saved listings"
                  }
                >
                  <svg
                    className={`w-5 h-5 ${
                      filters.savedOnly ? "text-white" : "text-gray-700"
                    }`}
                    fill={filters.savedOnly ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 016.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z"
                    />
                  </svg>
                </button>
              </div>
            </>
          )}

          {/* LISTINGS VIEW */}
          {mobileView === "listings" && (
            <div className="h-full overflow-y-auto bg-gray-50">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-500">
                  {visibleListings.length}{" "}
                  {viewportBounds ? "in this area" : "Listings Found"}
                </span>
                {viewportBounds && (
                  <button
                    onClick={() => setViewportBounds(null)}
                    className="text-xs text-red-600 font-medium"
                  >
                    Show all
                  </button>
                )}
              </div>
              <div className="px-4 pb-3 flex items-center gap-2">
                <button
                  onClick={() => setMobileFiltersOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-medium text-gray-700 shadow-sm active:bg-gray-50"
                >
                  <img
                    src="/assets/filter-icon.svg"
                    alt=""
                    className="w-3.5 h-3.5"
                    style={{ filter: "brightness(0) opacity(0.7)" }}
                  />
                  Filters
                </button>
                <button
                  onClick={() =>
                    setFilters({ ...filters, savedOnly: !filters.savedOnly })
                  }
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors active:opacity-80 shadow-sm ${
                    filters.savedOnly
                      ? "bg-red-500 border-red-500 text-white"
                      : "bg-white border-gray-200 text-gray-700"
                  }`}
                >
                  <svg
                    className={`w-3.5 h-3.5 ${
                      filters.savedOnly ? "text-white" : "text-gray-700"
                    }`}
                    fill={filters.savedOnly ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 016.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z"
                    />
                  </svg>
                  Saved
                </button>
              </div>
              <div className="px-4 pb-6 space-y-4">
                {visibleListings.length === 0
                  ? emptyState
                  : visibleListings.map((listing) => (
                      <ListingCard
                        key={listing._id}
                        listing={listing}
                        session={session}
                        onCardClick={() =>
                          router.push(`/listings/${listing._id}?from=listings`)
                        }
                      />
                    ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom toggle bar */}
        <div
          className="flex-shrink-0 bg-white border-t border-gray-200 flex"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <button
            onClick={() => switchMobileView("map")}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-semibold transition-colors ${
              mobileView === "map" ? "text-[#E8000B]" : "text-gray-400"
            }`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
            Map
          </button>
          <button
            onClick={() => switchMobileView("listings")}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-semibold transition-colors ${
              mobileView === "listings" ? "text-[#E8000B]" : "text-gray-400"
            }`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 10h16M4 14h16M4 18h16"
              />
            </svg>
            Listings
          </button>
        </div>

        {/* Filters drawer (slides up from bottom with backdrop) */}
        {mobileFiltersOpen && (
          <div className="fixed inset-0 z-50">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileFiltersOpen(false)}
            />
            {/* Panel */}
            <div
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl flex flex-col"
              style={{ maxHeight: "90vh" }}
            >
              <style>{SLIDER_CSS}</style>

              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 bg-gray-300 rounded-full" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
                <h2 className="text-lg font-bold text-gray-900">Filters</h2>
                <button
                  onClick={() => setMobileFiltersOpen(false)}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="overflow-y-auto flex-1 px-4 py-4 space-y-6">
                {/* Search */}
                <div>
                  <label className="block font-semibold text-gray-900 text-sm mb-2">
                    Search
                  </label>
                  <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-xl px-3 py-2.5 focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500">
                    <svg
                      className="w-4 h-4 text-red-500 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"
                      />
                    </svg>
                    <input
                      type="text"
                      placeholder="Search location or home"
                      value={search || ""}
                      onChange={(e) => setSearch && setSearch(e.target.value)}
                      onBlur={() => {
                        const url = new URL(window.location);
                        if (search) {
                          url.searchParams.set("search", search);
                        } else {
                          url.searchParams.delete("search");
                        }
                        window.history.replaceState({}, "", url);
                      }}
                      className="flex-1 outline-none text-sm bg-transparent text-gray-700 placeholder-gray-400"
                    />
                    {search && (
                      <button
                        onClick={() => {
                          setSearch && setSearch("");
                          const url = new URL(window.location);
                          url.searchParams.delete("search");
                          window.history.replaceState({}, "", url);
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Price Range */}
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-3">
                    Price Range
                  </p>
                  <DualRangeSlider
                    minRent={mobileDraft.minRent}
                    maxRent={mobileDraft.maxRent}
                    draft={mobileDraft}
                    setDraft={setMobileDraft}
                  />
                </div>

                {/* Bedrooms */}
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-3">
                    Bedrooms
                  </p>
                  <DualStepSlider
                    steps={BED_STEPS}
                    minValue={mobileDraft.bedrooms || "0"}
                    maxValue={mobileDraft.maxBedrooms || "5"}
                    onMinChange={(v) =>
                      setMobileDraft({
                        ...mobileDraft,
                        bedrooms: v === "0" ? "" : v,
                      })
                    }
                    onMaxChange={(v) =>
                      setMobileDraft({
                        ...mobileDraft,
                        maxBedrooms: v === "5" ? "" : v,
                      })
                    }
                    onSnapTo={(v) =>
                      setMobileDraft({
                        ...mobileDraft,
                        bedrooms: v === "0" ? "" : v,
                        maxBedrooms: v === "5" ? "" : v,
                      })
                    }
                  />
                </div>

                {/* Bathrooms */}
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-3">
                    Bathrooms
                  </p>
                  <DualStepSlider
                    steps={BATH_STEPS}
                    minValue={mobileDraft.bathrooms || "1"}
                    maxValue={mobileDraft.maxBathrooms || "4"}
                    onMinChange={(v) =>
                      setMobileDraft({
                        ...mobileDraft,
                        bathrooms: v === "1" ? "" : v,
                      })
                    }
                    onMaxChange={(v) =>
                      setMobileDraft({
                        ...mobileDraft,
                        maxBathrooms: v === "4" ? "" : v,
                      })
                    }
                    onSnapTo={(v) =>
                      setMobileDraft({
                        ...mobileDraft,
                        bathrooms: v === "1" ? "" : v,
                        maxBathrooms: v === "4" ? "" : v,
                      })
                    }
                  />
                </div>

                {/* Home Type */}
                <FilterSection title="Home Type">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "House", value: "house" },
                      { label: "Townhouse", value: "townhouse" },
                      { label: "Apartment", value: "apartment" },
                      { label: "Single Bedroom", value: "singleBedroom" },
                      { label: "Condo", value: "condo" },
                    ].map((opt) => {
                      const selected = mobileDraft.homeType?.includes(opt.value) || false;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => toggleMobileArray("homeType", opt.value)}
                          className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                            selected
                              ? "bg-red-500 text-white border-red-500"
                              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </FilterSection>

                {/* Lease Availability */}
                <FilterSection title="Lease Availability">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Semester Lease", value: "semester" },
                      { label: "10-Month Lease", value: "10-month" },
                      { label: "12-Month Lease", value: "12-month" },
                    ].map((opt) => {
                      const selected = mobileDraft.leaseAvailability?.includes(opt.value) || false;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => toggleMobileArray("leaseAvailability", opt.value)}
                          className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                            selected
                              ? "bg-red-500 text-white border-red-500"
                              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </FilterSection>

                {/* Amenities */}
                <FilterSection title="Amenities">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Dishwasher", value: "dishwasher" },
                      { label: "Extra Storage", value: "extraStorage" },
                      { label: "In-Unit Laundry", value: "inUnitLaundry" },
                      { label: "Fireplace", value: "fireplace" },
                      { label: "Private Parking", value: "freeParking" },
                      { label: "Mailroom", value: "mailroom" },
                      { label: "Pool", value: "pool" },
                      { label: "Pets Allowed", value: "petsAllowed" },
                      { label: "Study Rooms", value: "studyRooms" },
                      { label: "Gym / Fitness", value: "gym" },
                    ].map((opt) => {
                      const selected = mobileDraft.amenities?.includes(opt.value) || false;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => toggleMobileArray("amenities", opt.value)}
                          className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                            selected
                              ? "bg-red-500 text-white border-red-500"
                              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </FilterSection>

                {/* Utilities Included */}
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-2">Utilities Included</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: "water", label: "Water" },
                      { value: "electric", label: "Electric" },
                      { value: "gas", label: "Gas" },
                      { value: "internet", label: "Internet" },
                      { value: "trash", label: "Trash" },
                      { value: "hotWater", label: "Hot Water" },
                      { value: "sewer", label: "Sewer" },
                      { value: "yardCare", label: "Yard Care" },
                    ].map(({ value, label }) => {
                      const selected = (mobileDraft.utilitiesIncluded || []).includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            const cur = mobileDraft.utilitiesIncluded || [];
                            setMobileDraft({
                              ...mobileDraft,
                              utilitiesIncluded: selected
                                ? cur.filter((v) => v !== value)
                                : [...cur, value],
                            });
                          }}
                          className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                            selected
                              ? "bg-red-500 text-white border-red-500"
                              : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Move-in Date */}
                <div>
                  <label className="block font-semibold text-gray-900 text-sm mb-2">
                    Move-in Date
                  </label>
                  <input
                    type="date"
                    value={mobileDraft.moveInDate || ""}
                    onChange={(e) =>
                      setMobileDraft({
                        ...mobileDraft,
                        moveInDate: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                </div>

                {/* Furnished */}
                <div>
                  <label className="block font-semibold text-gray-900 text-sm mb-2">
                    Furnished
                  </label>
                  <select
                    value={mobileDraft.furnished || ""}
                    onChange={(e) =>
                      setMobileDraft({
                        ...mobileDraft,
                        furnished: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white"
                  >
                    <option value="">Any</option>
                    <option value="furnished">Furnished</option>
                    <option value="unfurnished">Unfurnished</option>
                  </select>
                </div>

                {/* Lease Structure */}
                <div>
                  <label className="block font-semibold text-gray-900 text-sm mb-2">
                    Lease Structure
                  </label>
                  <select
                    value={mobileDraft.leaseStructure || ""}
                    onChange={(e) =>
                      setMobileDraft({
                        ...mobileDraft,
                        leaseStructure: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white"
                  >
                    <option value="">Any</option>
                    <option value="individual">Individual Lease</option>
                    <option value="joint">Joint Lease</option>
                  </select>
                </div>

                {/* Toggles */}
                <div className="space-y-3">
                  {[
                    { label: "Sublease Friendly", field: "subleaseFriendly" },
                  ].map(({ label, field }) => (
                    <label
                      key={field}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <span className="text-sm font-medium text-gray-700">
                        {label}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setMobileDraft({
                            ...mobileDraft,
                            [field]: !mobileDraft[field],
                          })
                        }
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          mobileDraft[field] ? "bg-red-500" : "bg-gray-200"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            mobileDraft[field]
                              ? "translate-x-6"
                              : "translate-x-1"
                          }`}
                        />
                      </button>
                    </label>
                  ))}
                </div>

                {/* Walking Distance to Campus */}
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-3">
                    Walking Distance to Campus
                  </p>
                  <StepSlider
                    steps={DIST_STEPS}
                    value={mobileDraft.distance || ""}
                    onChange={(v) =>
                      setMobileDraft({ ...mobileDraft, distance: v })
                    }
                  />
                </div>

                {/* Walking Distance to Shuttle */}
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-3">
                    Walking Distance to Shuttle
                  </p>
                  <StepSlider
                    steps={SHTT_STEPS}
                    value={mobileDraft.distanceToShuttle || ""}
                    onChange={(v) =>
                      setMobileDraft({ ...mobileDraft, distanceToShuttle: v })
                    }
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-4 border-t border-gray-100 flex-shrink-0">
                <button
                  onClick={() => {
                    handleReset();
                    setMobileFiltersOpen(false);
                  }}
                  className="text-sm font-medium text-gray-600 hover:text-red-600 transition-colors"
                >
                  Reset all
                </button>
                <button
                  onClick={() => {
                    setFilters(mobileDraft);
                    setMobileFiltersOpen(false);
                  }}
                  className="px-8 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-full text-sm transition-colors shadow-md"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
