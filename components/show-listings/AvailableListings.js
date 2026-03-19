"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import dynamic from "next/dynamic";

import HeartIcon from "@/components/HeartIcon";
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
} from "@/components/show-listings/FilterComponents";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });


function MapPopupCard({ listing, session, routeActive, onRouteToggle, onClose, onCardClick }) {
  return (
    <div className="relative drop-shadow-2xl">
      <button
        onClick={onClose}
        className="absolute -top-3 -right-3 z-10 bg-white rounded-full shadow-lg p-1.5 border border-gray-200 hover:bg-gray-50 transition-colors"
        aria-label="Close"
      >
        <svg className="w-3.5 h-3.5 text-gray-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <ListingCard listing={listing} session={session} onCardClick={onCardClick} />
      <button
        onClick={onRouteToggle}
        className={`w-full mt-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors duration-200 shadow ${
          routeActive ? "bg-red-600 text-white hover:bg-red-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
        }`}
      >
        {routeActive ? "Hide Route to Campus" : "📍 Show Route to Campus"}
      </button>
    </div>
  );
}

// Shared listing card used by both desktop grid and mobile drawer
function ListingCard({ listing, session, onCardClick }) {
  const imageUrl = listing.images?.[0];
  const imageCount = listing.images?.length || 0;
  const [streetAddress, ...restParts] = listing.address.split(",");
  const cityStateZip = restParts.join(",").trim();
  const bedValues = listing.unitTypes.map((u) => u.bedrooms).filter(Number.isFinite);
  const bathValues = listing.unitTypes.map((u) => u.bathrooms).filter(Number.isFinite);
  const bedLabel =
    bedValues.length === 0
      ? "N/A"
      : Math.min(...bedValues) === Math.max(...bedValues)
      ? String(Math.min(...bedValues))
      : `${Math.min(...bedValues)}-${Math.max(...bedValues)}`;
  const bathLabel =
    bathValues.length === 0
      ? "N/A"
      : Math.min(...bathValues) === Math.max(...bathValues)
      ? String(Math.min(...bathValues))
      : `${Math.min(...bathValues)}-${Math.max(...bathValues)}`;

  return (
    <div
      className="relative group bg-white rounded-2xl shadow-lg transition-colors duration-200 overflow-hidden border border-gray-100 hover:border-red-200 flex flex-col cursor-pointer"
      onClick={() => onCardClick(listing._id)}
    >
      <div className="relative">
        {imageUrl ? (
          <img src={imageUrl} alt={listing.address} className="w-full aspect-video object-cover" />
        ) : (
          <div className="w-full aspect-video bg-gray-100 flex items-center justify-center text-gray-400">
            No image
          </div>
        )}
        {imageCount > 1 && (
          <div className="absolute bottom-3 right-3 bg-black/70 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
            See all {imageCount} photos
          </div>
        )}
      </div>
      <div className="p-3 bg-[#fafafa] flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-sm text-gray-900 leading-snug">{streetAddress}</h3>
            {cityStateZip && (
              <p className="text-xs text-gray-500 font-normal mt-0.5">{cityStateZip}</p>
            )}
          </div>
          <span className="text-red-500 font-bold text-sm whitespace-nowrap flex-shrink-0">
            {getRentRangeLabel(listing.unitTypes)}
            <span className="text-xs font-normal">/mo</span>
          </span>
        </div>
        <div className="flex items-center justify-between mt-auto pt-2">
          <span className="text-gray-500 text-xs">
            {bedLabel} bed{" | "}{bathLabel} bath
            {listing.leaseType ? ` | ${listing.leaseType}` : ""}
          </span>
          {listing.owner?.name && (
            <span className="text-gray-400 text-xs truncate ml-2">{listing.owner.name}</span>
          )}
        </div>
      </div>
      <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-red-600 transition-[width] duration-300 group-hover:w-full" />
      <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full p-2 shadow-xl border border-white/50">
        <HeartIcon
          session={session}
          listingId={listing._id}
          initial={
            Boolean(session?.user) &&
            Boolean(
              session?.user?.favorites?.some(
                (f) => String((f && f._id) || f) === String(listing._id)
              ) || session?.user?.favoritesIds?.includes(String(listing._id))
            )
          }
        />
      </div>
    </div>
  );
}

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

  /* ── Map overlay card state ── */
  const [selectedListing, setSelectedListing] = useState(null);
  const [routeActive, setRouteActive] = useState(false);

  /* ── Mobile UI state ── */
  const [mobileListingsOpen, setMobileListingsOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileDraft, setMobileDraft] = useState(filters);

  // Sync mobileDraft when filter panel opens
  useEffect(() => {
    if (mobileFiltersOpen) setMobileDraft(filters);
  }, [mobileFiltersOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear map overlay card when listings data changes
  useEffect(() => { setSelectedListing(null); }, [listings]);

  // Clear route when overlay card is dismissed or swapped
  useEffect(() => {
    if (typeof window !== "undefined") window.hideRoute?.();
    setRouteActive(false);
  }, [selectedListing]);

  const handleRouteToggle = () => {
    if (!selectedListing) return;
    if (routeActive) {
      window.hideRoute?.();
      setRouteActive(false);
    } else {
      window.showRouteToCampus?.([selectedListing.longitude, selectedListing.latitude], selectedListing._id);
      setRouteActive(true);
    }
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
      [field]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
    });
  };

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
        <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      </div>
      <h3 className="text-2xl font-bold text-gray-900 mb-3">No listings found</h3>
      <p className="text-gray-600 mb-6 max-w-md leading-relaxed">
        We couldn&apos;t find any listings matching your criteria. Try adjusting your filters or search terms.
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
        className="hidden md:block w-[40vw] shrink-0 overflow-y-auto px-4 py-4"
        style={{ height: "100%", minHeight: 0 }}
      >
        <p className="text-sm font-semibold text-gray-500 px-1 mb-4">
          {listings.length} Listings Found
        </p>

        {listings.length === 0 ? emptyState : (
          <div className="grid grid-cols-2 gap-6">
            {listings.map((listing) => (
              <ListingCard
                key={listing._id}
                listing={listing}
                session={session}
                onCardClick={handleListingClick}
              />
            ))}
          </div>
        )}
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
          onListingSelect={setSelectedListing}
          selectedListingId={selectedListing?._id}
        />
        {selectedListing && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-72 pointer-events-auto">
            <MapPopupCard
              listing={selectedListing}
              session={session}
              routeActive={routeActive}
              onRouteToggle={handleRouteToggle}
              onClose={() => setSelectedListing(null)}
              onCardClick={handleListingClick}
            />
          </div>
        )}
      </div>

      {/* ── Mobile: map-first layout ── */}
      <div className="md:hidden w-full relative" style={{ height: "100%" }}>
        {/* Full-screen map */}
        <MapView
          listings={listings}
          filters={filters}
          setFilters={setFilters}
          handleReset={handleReset}
          onListingSelect={(listing) => {
            setSelectedListing(listing);
            setMobileListingsOpen(false);
          }}
          selectedListingId={selectedListing?._id}
        />

        {/* Map overlay card — shown when a pin is clicked and drawer is closed */}
        {selectedListing && !mobileListingsOpen && (
          <div className="absolute bottom-20 left-4 right-4 z-10 pointer-events-auto">
            <MapPopupCard
              listing={selectedListing}
              session={session}
              routeActive={routeActive}
              onRouteToggle={handleRouteToggle}
              onClose={() => setSelectedListing(null)}
              onCardClick={(id) => { setSelectedListing(null); handleListingClick(id); }}
            />
          </div>
        )}

        {/* Top-left: Filter icon + Heart stacked */}
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
        <button
          onClick={() => setMobileFiltersOpen(true)}
          className="bg-white rounded-full p-3 shadow-lg border border-gray-200 active:bg-gray-50"
          aria-label="Open filters"
        >
          <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
        </button>

        {/* Heart (saved filter toggle) */}
        <button
          onClick={() => setFilters({ ...filters, savedOnly: !filters.savedOnly })}
          className={`rounded-full p-3 shadow-lg border active:opacity-80 transition-colors ${
            filters.savedOnly
              ? "bg-red-500 border-red-500"
              : "bg-white border-gray-200"
          }`}
          aria-label={filters.savedOnly ? "Show all listings" : "Show saved listings"}
        >
          <svg
            className={`w-5 h-5 ${filters.savedOnly ? "text-white" : "text-gray-700"}`}
            fill={filters.savedOnly ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 016.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z" />
          </svg>
        </button>
        </div>

        {/* Bottom: Arrow-up tab (full width, always visible when drawer is closed) */}
        {!mobileListingsOpen && (
          <button
            onClick={() => setMobileListingsOpen(true)}
            className="absolute bottom-0 left-0 right-0 w-full bg-white rounded-t-3xl py-3 z-10 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] flex items-center justify-center active:bg-gray-50"
            aria-label="View listings"
          >
            <img src="/assets/arrow-open-tab.svg" className="w-8 h-8" alt="" />
          </button>
        )}

        {/* Tap-on-map backdrop to close listings drawer */}
        {mobileListingsOpen && (
          <div
            className="absolute inset-0 z-[15]"
            onClick={() => setMobileListingsOpen(false)}
          />
        )}

        {/* Listings drawer (slides up from bottom) */}
        <div
          className={`absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl z-20 flex flex-col transition-transform duration-300 ease-out ${
            mobileListingsOpen ? "translate-y-0" : "translate-y-full"
          }`}
          style={{ maxHeight: "80vh" }}
        >
          {/* Sticky header – swipe down to close */}
          <div
            className="flex-shrink-0 bg-white rounded-t-3xl sticky top-0 z-10"
            onTouchStart={(e) => {
              e.currentTarget._touchStartY = e.touches[0].clientY;
            }}
            onTouchEnd={(e) => {
              const delta = e.changedTouches[0].clientY - (e.currentTarget._touchStartY || 0);
              if (delta > 50) setMobileListingsOpen(false);
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>
            {/* Count row */}
            <div className="flex items-center justify-center px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-500">
                {listings.length} Listings Found
              </span>
            </div>
          </div>
          {/* Scrollable cards */}
          <div className="overflow-y-auto flex-1 px-4 py-4 pb-8">
            {listings.length === 0 ? emptyState : (
              <div className="grid grid-cols-1 gap-4">
                {listings.map((listing) => (
                  <ListingCard
                    key={listing._id}
                    listing={listing}
                    session={session}
                    onCardClick={(id) => {
                      setMobileListingsOpen(false);
                      handleListingClick(id);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
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
            <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl flex flex-col" style={{ maxHeight: "90vh" }}>
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
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="overflow-y-auto flex-1 px-4 py-4 space-y-6">

                {/* Search */}
                <div>
                  <label className="block font-semibold text-gray-900 text-sm mb-2">Search</label>
                  <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-xl px-3 py-2.5 focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500">
                    <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Search location or home"
                      value={search || ""}
                      onChange={(e) => setSearch && setSearch(e.target.value)}
                      className="flex-1 outline-none text-sm bg-transparent text-gray-700 placeholder-gray-400"
                    />
                    {search && (
                      <button onClick={() => setSearch && setSearch("")} className="text-gray-400 hover:text-gray-600">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Price Range */}
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-3">Price Range</p>
                  <DualRangeSlider
                    minRent={mobileDraft.minRent}
                    maxRent={mobileDraft.maxRent}
                    draft={mobileDraft}
                    setDraft={setMobileDraft}
                  />
                </div>

                {/* Bedrooms */}
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-3">Bedrooms</p>
                  <DualStepSlider
                    steps={BED_STEPS}
                    minValue={mobileDraft.bedrooms || "0"}
                    maxValue={mobileDraft.maxBedrooms || "5"}
                    onMinChange={(v) => setMobileDraft({ ...mobileDraft, bedrooms: v === "0" ? "" : v })}
                    onMaxChange={(v) => setMobileDraft({ ...mobileDraft, maxBedrooms: v === "5" ? "" : v })}
                  />
                </div>

                {/* Bathrooms */}
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-3">Bathrooms</p>
                  <DualStepSlider
                    steps={BATH_STEPS}
                    minValue={mobileDraft.bathrooms || "1"}
                    maxValue={mobileDraft.maxBathrooms || "4"}
                    onMinChange={(v) => setMobileDraft({ ...mobileDraft, bathrooms: v === "1" ? "" : v })}
                    onMaxChange={(v) => setMobileDraft({ ...mobileDraft, maxBathrooms: v === "4" ? "" : v })}
                  />
                </div>

                {/* Home Type */}
                <FilterSection title="Home Type">
                  <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                    {[
                      { label: "House", value: "house" },
                      { label: "Townhouse", value: "townhouse" },
                      { label: "Apartment", value: "apartment" },
                      { label: "Single Bedroom", value: "singleBedroom" },
                      { label: "Condo", value: "condo" },
                    ].map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={mobileDraft.homeType?.includes(opt.value) || false}
                          onChange={() => toggleMobileArray("homeType", opt.value)}
                          className="rounded border-gray-300 text-red-500 focus:ring-red-500 w-4 h-4 accent-red-500"
                        />
                        <span className="text-sm text-gray-700">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </FilterSection>

                {/* Lease Availability */}
                <FilterSection title="Lease Availability">
                  <div className="space-y-2">
                    {[
                      { label: "Semester Lease", value: "semester" },
                      { label: "10-Month Lease", value: "10-month" },
                      { label: "12-Month Lease", value: "12-month" },
                    ].map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={mobileDraft.leaseAvailability?.includes(opt.value) || false}
                          onChange={() => toggleMobileArray("leaseAvailability", opt.value)}
                          className="rounded border-gray-300 text-red-500 focus:ring-red-500 w-4 h-4 accent-red-500"
                        />
                        <span className="text-sm text-gray-700">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </FilterSection>

                {/* Amenities */}
                <FilterSection title="Amenities">
                  <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                    {[
                      { label: "Dishwasher",      value: "dishwasher"    },
                      { label: "Extra Storage",   value: "extraStorage"  },
                      { label: "In-Unit Laundry", value: "inUnitLaundry" },
                      { label: "Fireplace",       value: "fireplace"     },
                      { label: "Private Parking", value: "freeParking"   },
                      { label: "Mailroom",        value: "mailroom"      },
                      { label: "Pool",            value: "pool"          },
                      { label: "Pets Allowed",    value: "petsAllowed"   },
                      { label: "Study Rooms",     value: "studyRooms"    },
                      { label: "Gym / Fitness",   value: "gym"           },
                    ].map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={mobileDraft.amenities?.includes(opt.value) || false}
                          onChange={() => toggleMobileArray("amenities", opt.value)}
                          className="rounded border-gray-300 text-red-500 focus:ring-red-500 w-4 h-4 accent-red-500"
                        />
                        <span className="text-sm text-gray-700">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </FilterSection>

                {/* Move-in Date */}
                <div>
                  <label className="block font-semibold text-gray-900 text-sm mb-2">Move-in Date</label>
                  <input
                    type="date"
                    value={mobileDraft.moveInDate || ""}
                    onChange={(e) => setMobileDraft({ ...mobileDraft, moveInDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                </div>

                {/* Furnished */}
                <div>
                  <label className="block font-semibold text-gray-900 text-sm mb-2">Furnished</label>
                  <select
                    value={mobileDraft.furnished || ""}
                    onChange={(e) => setMobileDraft({ ...mobileDraft, furnished: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white"
                  >
                    <option value="">Any</option>
                    <option value="furnished">Furnished</option>
                    <option value="unfurnished">Unfurnished</option>
                  </select>
                </div>

                {/* Lease Structure */}
                <div>
                  <label className="block font-semibold text-gray-900 text-sm mb-2">Lease Structure</label>
                  <select
                    value={mobileDraft.leaseStructure || ""}
                    onChange={(e) => setMobileDraft({ ...mobileDraft, leaseStructure: e.target.value })}
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
                    { label: "Utilities Included", field: "utilitiesIncluded" },
                    { label: "Sublease Friendly",  field: "subleaseFriendly"  },
                  ].map(({ label, field }) => (
                    <label key={field} className="flex items-center justify-between cursor-pointer">
                      <span className="text-sm font-medium text-gray-700">{label}</span>
                      <button
                        type="button"
                        onClick={() => setMobileDraft({ ...mobileDraft, [field]: !mobileDraft[field] })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${mobileDraft[field] ? "bg-red-500" : "bg-gray-200"}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${mobileDraft[field] ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                    </label>
                  ))}
                </div>

                {/* Distance to Campus */}
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-3">Distance to Campus</p>
                  <StepSlider
                    steps={DIST_STEPS}
                    value={mobileDraft.distance || ""}
                    onChange={(v) => setMobileDraft({ ...mobileDraft, distance: v })}
                  />
                </div>

                {/* Distance to Shuttle */}
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-3">Distance to Campus Shuttle</p>
                  <StepSlider
                    steps={SHTT_STEPS}
                    value={mobileDraft.distanceToShuttle || ""}
                    onChange={(v) => setMobileDraft({ ...mobileDraft, distanceToShuttle: v })}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-4 border-t border-gray-100 flex-shrink-0">
                <button
                  onClick={() => { handleReset(); setMobileFiltersOpen(false); }}
                  className="text-sm font-medium text-gray-600 hover:text-red-600 transition-colors"
                >
                  Reset all
                </button>
                <button
                  onClick={() => { setFilters(mobileDraft); setMobileFiltersOpen(false); }}
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
