"use client";

import { startTransition, useEffect, useOptimistic, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PriceFilterCard from "@/components/listings/PriceFilterCard";
import BedBathFilterCard from "@/components/listings/BedBathFilterCard";
import FiltersPanel from "@/components/listings/FiltersPanel";

function FilterDropdownPortal({ children, isOpen }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto" }}>{children}</div>
    </div>,
    document.body
  );
}

// Dropdown holding one of the filter cards or the side panel; pos holds the
// fixed offsets (top / left / right / bottom) it is anchored at.
function CardDropdown({ isOpen, pos, onClose, modal = true, children }) {
  return (
    <FilterDropdownPortal isOpen={isOpen}>
      {modal && <div className="fixed inset-0 z-[100]" onClick={onClose} />}
      <div className="fixed z-[101]" style={pos}>
        <div
          className="filter-dropdown flex max-h-full flex-col"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </FilterDropdownPortal>
  );
}

const CHEVRON = (
  <svg
    className="w-4 h-4"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

export default function TopFilterBar({
  search,
  setSearch,
  listings,
  filters: committedFilters,
  setFilters: commitFilters,
  onReset,
  onFiltersSaved = () => {},
  mapHidden,
  onToggleMap,
  compareOpen,
  onToggleCompare,
}) {
  /*
   * Rebuilding the results (a couple of hundred cards and the map pins) is the
   * expensive part of a filter change, and it used to run in the same update as
   * the click, so nothing in the bar changed until it had finished (about half a
   * second in dev when Saved went off). The commit is now a transition: the
   * bar's own controls take the new value at once (optimistic copy) and the
   * results follow without blocking them.
   */
  const [filters, setLiveFilters] = useOptimistic(committedFilters);
  // The side panel edits its own copy of the filters. With the map hidden the
  // bar stays usable while the panel is open, so a change or a reset made in the
  // bar bumps this and the panel starts over from the new filters (its unapplied
  // edits are dropped), instead of later applying its old copy over them.
  const [panelEpoch, setPanelEpoch] = useState(0);
  const setFilters = (next) =>
    startTransition(() => {
      setLiveFilters(next);
      commitFilters(next);
      setPanelEpoch((epoch) => epoch + 1);
    });
  const [showFilters, setShowFilters] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const filterRef = useRef(null);

  const openPill = (e, name) => {
    e.stopPropagation();
    if (showFilters === name) {
      setShowFilters(false);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    // Anchor to left edge of button, clamp so dropdown doesn't overflow right side
    const left = Math.min(rect.left, window.innerWidth - 320 - 12);
    setDropdownPos({ top: rect.bottom + 6, left });
    setShowFilters(name);
  };

  useEffect(() => {
    const isOutside = (target) =>
      !target.closest(".filter-dropdown") &&
      filterRef.current &&
      !filterRef.current.contains(target);
    // Closes on a click that began and ended outside, not on the mousedown: with
    // the map hidden the grid slides when the side panel closes, which moved the
    // card out from under the cursor before the click finished. (Not on every
    // click either: a slider drag released outside must not close the panel.)
    let pressedOutside = false;
    const onMouseDown = (event) => {
      pressedOutside = isOutside(event.target);
    };
    const onClick = (event) => {
      if (pressedOutside && isOutside(event.target)) setShowFilters(false);
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  useEffect(() => {
    if (showFilters) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = orig;
      };
    }
  }, [showFilters]);

  // Marks the page while the side panel is open, so the map-hidden card grid can
  // make room for it (styled in AvailableListings, with no re-render).
  useEffect(() => {
    document.body.toggleAttribute(
      "data-filters-panel",
      showFilters === "more-filters"
    );
    return () => document.body.removeAttribute("data-filters-panel");
  }, [showFilters]);

  const hasActiveFilters =
    filters.bedrooms ||
    filters.maxBedrooms ||
    filters.bathrooms ||
    filters.maxBathrooms ||
    filters.minRent ||
    filters.maxRent ||
    filters.distance ||
    filters.distanceToShuttle ||
    filters.moveInDate ||
    filters.homeType?.length > 0 ||
    filters.leaseAvailability?.length > 0 ||
    filters.amenities?.length > 0 ||
    filters.furnished ||
    filters.utilitiesIncluded?.length > 0 ||
    filters.subleaseFriendly ||
    filters.subleaseOnly ||
    filters.leaseStructure ||
    filters.savedOnly ||
    search;

  // Pill display labels for beds/baths
  const bedLabel =
    filters.bedrooms && filters.bedrooms === filters.maxBedrooms
      ? `${filters.bedrooms} Beds`
      : filters.bedrooms && filters.maxBedrooms
      ? `${filters.bedrooms}–${filters.maxBedrooms} Beds`
      : filters.bedrooms
      ? `${filters.bedrooms}+ Beds`
      : filters.maxBedrooms
      ? `≤${filters.maxBedrooms} Beds`
      : "";

  const bathLabel =
    filters.bathrooms && filters.bathrooms === filters.maxBathrooms
      ? `${filters.bathrooms} Baths`
      : filters.bathrooms && filters.maxBathrooms
      ? `${filters.bathrooms}–${filters.maxBathrooms} Baths`
      : filters.bathrooms
      ? `${filters.bathrooms}+ Baths`
      : filters.maxBathrooms
      ? `≤${filters.maxBathrooms} Baths`
      : "";

  const priceActive = !!(filters.minRent || filters.maxRent);
  const bedsActive = !!(filters.bedrooms || filters.maxBedrooms);
  const bathsActive = !!(filters.bathrooms || filters.maxBathrooms);
  const bedBathLabel = [bedLabel, bathLabel].filter(Boolean).join(" · ") || "Beds & Baths";

  // Apply button of the card dropdowns: filters take effect, then it closes.
  const applyCard = (values) => {
    const next = { ...filters, ...values };
    setFilters(next);
    onFiltersSaved(next);
    setShowFilters(false);
  };

  return (
    <>
      {/* ── Top bar ── */}
      <div
        ref={filterRef}
        className="w-full bg-white border-b border-gray-200 pl-5 pr-3 py-2.5 flex items-center gap-2 flex-wrap shadow-sm"
      >
        {/* Search pill */}
        <div className="flex items-center flex-1 min-w-[200px] max-w-sm bg-white border border-gray-300 rounded-full px-3 py-2 shadow-sm focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500 transition-all gap-2">
          <svg
            className="w-3.5 h-3.5 text-red-500 flex-shrink-0"
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => {
              const url = new URL(window.location);
              if (search) {
                url.searchParams.set("search", search);
              } else {
                url.searchParams.delete("search");
              }
              window.history.replaceState({}, "", url);
            }}
            className="flex-1 outline-none text-[13px] bg-transparent text-gray-700 placeholder-gray-400"
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                const url = new URL(window.location);
                url.searchParams.delete("search");
                window.history.replaceState({}, "", url);
              }}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg
                className="w-3 h-3"
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

        {/* Price pill */}
        <button
          onClick={(e) => openPill(e, "price")}
          className={`flex items-center gap-1.5 px-4 py-2 border rounded-full text-[13px] font-medium transition-colors whitespace-nowrap ${
            priceActive
              ? "bg-gray-200 text-gray-700 border-gray-300"
              : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          <span>Price</span>
          {CHEVRON}
        </button>

        {/* Beds & Baths pill */}
        <button
          onClick={(e) => openPill(e, "bedbath")}
          className={`flex items-center gap-1.5 px-4 py-2 border rounded-full text-[13px] font-medium transition-colors whitespace-nowrap ${
            bedsActive || bathsActive
              ? "bg-gray-200 text-gray-700 border-gray-300"
              : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          <span>{bedBathLabel}</span>
          {CHEVRON}
        </button>

        {/* Saved / Favorites filter */}
        <button
          onClick={() =>
            setFilters({ ...filters, savedOnly: !filters.savedOnly })
          }
          className={`flex items-center gap-1.5 px-4 py-2 border rounded-full text-[13px] font-medium transition-colors whitespace-nowrap ${
            filters.savedOnly
              ? "bg-gray-200 text-gray-700 border-gray-300"
              : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          <svg
            className="w-3.5 h-3.5"
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
          <span>Saved</span>
        </button>

        {/* Filters pill */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            // The side panel docks where the compare panel is, so it replaces it.
            if (compareOpen && showFilters !== "more-filters") onToggleCompare();
            // Docked at the right edge, a little below the bar (as in the design).
            setDropdownPos({
              top: filterRef.current.getBoundingClientRect().bottom + 17,
              right: 25,
              bottom: 16,
            });
            setShowFilters(
              showFilters === "more-filters" ? false : "more-filters"
            );
          }}
          className={`flex items-center gap-1.5 px-4 py-2 border border-gray-300 rounded-full text-[13px] font-medium text-gray-700 transition-colors whitespace-nowrap ${
            showFilters === "more-filters" ? "bg-gray-200" : "bg-white hover:bg-gray-50"
          }`}
        >
          <img
            src="/assets/filter-icon.svg"
            alt=""
            className="w-3.5 h-3.5"
            style={{ filter: "brightness(0) opacity(0.65)" }}
          />
          <span>Filters</span>
        </button>

        {/* Compare Listings: not a filter, so it is outside the filter state and Clear All */}
        <button
          onClick={onToggleCompare}
          className={`flex items-center gap-1.5 px-4 py-2 border rounded-full text-[13px] font-medium transition-colors whitespace-nowrap ${
            compareOpen
              ? "bg-gray-200 text-gray-700 border-gray-300"
              : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          Compare Listings
        </button>

        {/* Clear All */}
        <button
          onClick={() => {
            onReset();
            setPanelEpoch((epoch) => epoch + 1);
          }}
          className={`flex items-center gap-1 px-3 py-2 text-[13px] font-medium transition-colors rounded-full whitespace-nowrap ${
            hasActiveFilters
              ? "text-red-600 hover:bg-red-50 border border-red-200"
              : "text-gray-400 border border-gray-200"
          }`}
        >
          <svg
            className="w-3 h-3"
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
          <span>Clear All</span>
        </button>

        {/* Hide / Show Map */}
        <button
          onClick={onToggleMap}
          // 22px on top of the bar's 12px padding: 34px from the page edge, as in the design.
          className="ml-auto mr-[22px] flex items-center gap-1.5 px-4 py-2 border border-gray-300 rounded-full text-[13px] font-medium bg-white text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
        >
          {mapHidden ? "Show Map" : "Hide Map"}
        </button>
      </div>

      {/* ── Price dropdown ── */}
      <CardDropdown
        isOpen={showFilters === "price"}
        pos={dropdownPos}
        onClose={() => setShowFilters(false)}
      >
        <PriceFilterCard
          listings={listings}
          minRent={filters.minRent}
          maxRent={filters.maxRent}
          onApply={applyCard}
        />
      </CardDropdown>

      {/* ── Beds & Baths dropdown ── */}
      <CardDropdown
        isOpen={showFilters === "bedbath"}
        pos={dropdownPos}
        onClose={() => setShowFilters(false)}
      >
        <BedBathFilterCard filters={filters} onApply={applyCard} />
      </CardDropdown>

      {/* ── Filters panel ── */}
      <CardDropdown
        isOpen={showFilters === "more-filters"}
        pos={dropdownPos}
        onClose={() => setShowFilters(false)}
        // With the map hidden the cards sit beside the panel and stay usable:
        // no click-catching layer (a click outside still closes it, see above).
        modal={!mapHidden}
      >
        <FiltersPanel
          key={panelEpoch}
          listings={listings}
          filters={filters}
          onApply={applyCard}
          onReset={onReset}
        />
      </CardDropdown>
    </>
  );
}
