"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

// FilterSection, DualRangeSlider, StepSlider, DualStepSlider, and step constants
// are imported from FilterComponents.js above.

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

const CHEVRON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

export default function TopFilterBar({ search, setSearch, filters, setFilters, onReset }) {
  const [showFilters, setShowFilters] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const filterRef = useRef(null);

  const openPill = (e, name) => {
    e.stopPropagation();
    if (showFilters === name) { setShowFilters(false); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    // Anchor to left edge of button, clamp so dropdown doesn't overflow right side
    const left = Math.min(rect.left, window.innerWidth - 320 - 12);
    setDropdownPos({ top: rect.bottom + 6, left });
    setShowFilters(name);
  };

  // Sync draft when modal opens
  useEffect(() => {
    if (showFilters === "more-filters") setDraft(filters);
  }, [showFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterDropdownWheel = (e) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight;
    if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) e.preventDefault();
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (event.target.closest(".filter-dropdown")) return;
      if (filterRef.current && !filterRef.current.contains(event.target)) setShowFilters(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (showFilters) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = orig; };
    }
  }, [showFilters]);

  const hasActiveFilters =
    filters.leaseType || filters.bedrooms || filters.maxBedrooms ||
    filters.bathrooms || filters.maxBathrooms ||
    filters.minRent || filters.maxRent || filters.distance ||
    filters.distanceToShuttle || filters.moveInDate ||
    filters.homeType?.length > 0 || filters.leaseAvailability?.length > 0 ||
    filters.amenities?.length > 0 || filters.furnished ||
    filters.utilitiesIncluded || filters.subleaseFriendly ||
    filters.leaseStructure || filters.savedOnly || search;

  // Pill display labels for beds/baths
  const bedLabel = filters.bedrooms && filters.maxBedrooms
    ? `${filters.bedrooms}–${filters.maxBedrooms} Beds`
    : filters.bedrooms    ? `${filters.bedrooms}+ Beds`
    : filters.maxBedrooms ? `≤${filters.maxBedrooms} Beds`
    : "Bedroom";

  const bathLabel = filters.bathrooms && filters.maxBathrooms
    ? `${filters.bathrooms}–${filters.maxBathrooms} Baths`
    : filters.bathrooms    ? `${filters.bathrooms}+ Baths`
    : filters.maxBathrooms ? `≤${filters.maxBathrooms} Baths`
    : "Bath";

  const bedsActive  = !!(filters.bedrooms  || filters.maxBedrooms);
  const bathsActive = !!(filters.bathrooms || filters.maxBathrooms);

  const toggleArray = (field, value) => {
    const arr = draft[field] || [];
    setDraft({ ...draft, [field]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] });
  };

  return (
    <>
      {/* ── Top bar ── */}
      <div
        ref={filterRef}
        className="w-full bg-white border-b border-gray-200 pl-6 pr-4 py-4 flex items-center gap-3 flex-wrap shadow-sm"
      >
        {/* Search pill */}
        <div className="flex items-center flex-1 min-w-[200px] max-w-sm bg-white border border-gray-300 rounded-full px-4 py-3 shadow-sm focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500 transition-all gap-2">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search location or home"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 outline-none text-sm bg-transparent text-gray-700 placeholder-gray-400"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Lease Type pill */}
        <button
          onClick={(e) => openPill(e, "lease-type")}
          className={`flex items-center gap-2 px-5 py-3 border rounded-full text-sm font-medium transition-colors whitespace-nowrap ${filters.leaseType ? "bg-red-600 text-white border-red-600" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
        >
          <span>{filters.leaseType ? filters.leaseType.charAt(0).toUpperCase() + filters.leaseType.slice(1) : "Lease Type"}</span>
          {CHEVRON}
        </button>

        {/* Bedroom pill */}
        <button
          onClick={(e) => openPill(e, "bedroom")}
          className={`flex items-center gap-2 px-5 py-3 border rounded-full text-sm font-medium transition-colors whitespace-nowrap ${bedsActive ? "bg-red-600 text-white border-red-600" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
        >
          <span>{bedLabel}</span>
          {CHEVRON}
        </button>

        {/* Bath pill */}
        <button
          onClick={(e) => openPill(e, "bath")}
          className={`flex items-center gap-2 px-5 py-3 border rounded-full text-sm font-medium transition-colors whitespace-nowrap ${bathsActive ? "bg-red-600 text-white border-red-600" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
        >
          <span>{bathLabel}</span>
          {CHEVRON}
        </button>

        {/* Saved / Favorites filter */}
        <button
          onClick={() => setFilters({ ...filters, savedOnly: !filters.savedOnly })}
          className={`flex items-center gap-2 px-5 py-3 border rounded-full text-sm font-medium transition-colors whitespace-nowrap ${filters.savedOnly ? "bg-red-600 text-white border-red-600" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
        >
          <svg className="w-4 h-4" fill={filters.savedOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 016.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z" />
          </svg>
          <span>Saved</span>
        </button>

        {/* More Filters pill */}
        <button
          onClick={(e) => { e.stopPropagation(); setShowFilters(showFilters === "more-filters" ? false : "more-filters"); }}
          className="flex items-center gap-2 px-5 py-3 border border-gray-300 rounded-full text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
        >
          <img src="/assets/filter-icon.svg" alt="" className="w-4 h-4" style={{ filter: 'brightness(0) opacity(0.65)' }} />
          <span>More Filters</span>
        </button>

        {/* Clear All */}
        <button
          onClick={onReset}
          className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors rounded-full whitespace-nowrap ${hasActiveFilters ? "text-red-600 hover:bg-red-50 border border-red-200" : "text-gray-400 border border-gray-200"}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span>Clear All</span>
        </button>
      </div>

      {/* ── Lease Type dropdown ── */}
      <FilterDropdownPortal isOpen={showFilters === "lease-type"}>
        <div className="fixed inset-0 z-[100]" onClick={() => setShowFilters(false)} />
        <div className="fixed z-[101]" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <div className="filter-dropdown bg-white border border-gray-200 rounded-xl shadow-xl p-6 w-64"
            onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-3">Home Type</h3>
            <div className="space-y-1">
              {[
                { label: "Any", value: "" },
                { label: "Apartment", value: "apartment" },
                { label: "House", value: "house" },
                { label: "Condo", value: "condo" },
                { label: "Townhouse", value: "townhouse" },
              ].map((opt) => (
                <button key={opt.value}
                  onClick={() => { setFilters({ ...filters, leaseType: opt.value }); setShowFilters(false); }}
                  className={`block w-full text-left px-4 py-2 rounded-lg text-sm transition-colors ${filters.leaseType === opt.value ? "bg-red-600 text-white" : "text-gray-700 hover:bg-gray-50"}`}>
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex justify-between mt-4 pt-3 border-t border-gray-100">
              <button onClick={() => setFilters({ ...filters, leaseType: "" })} className="text-red-600 hover:bg-red-50 px-4 py-1.5 rounded-lg text-sm">Reset</button>
              <button onClick={() => setShowFilters(false)} className="bg-red-500 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-red-600">Done</button>
            </div>
          </div>
        </div>
      </FilterDropdownPortal>

      {/* ── Bedroom dropdown ── */}
      <FilterDropdownPortal isOpen={showFilters === "bedroom"}>
        <style>{SLIDER_CSS}</style>
        <div className="fixed inset-0 z-[100]" onClick={() => setShowFilters(false)} />
        <div className="fixed z-[101]" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <div className="filter-dropdown bg-white border border-gray-200 rounded-xl shadow-xl p-6 w-80"
            onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-4">Bedrooms</h3>
            <div className="mb-6">
              <DualStepSlider
                steps={BED_STEPS}
                minValue={filters.bedrooms || "0"}
                maxValue={filters.maxBedrooms || "5"}
                onMinChange={(v) => setFilters({ ...filters, bedrooms: v === "0" ? "" : v })}
                onMaxChange={(v) => setFilters({ ...filters, maxBedrooms: v === "5" ? "" : v })}
                onSnapTo={(v) => setFilters({ ...filters, bedrooms: v === "0" ? "" : v, maxBedrooms: v === "5" ? "" : v })}
              />
            </div>
            <div className="flex justify-between">
              <button onClick={() => setFilters({ ...filters, bedrooms: "", maxBedrooms: "" })} className="text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg text-sm">Reset</button>
              <button onClick={() => setShowFilters(false)} className="bg-red-500 text-white px-6 py-2 rounded-lg text-sm hover:bg-red-600">Done</button>
            </div>
          </div>
        </div>
      </FilterDropdownPortal>

      {/* ── Bath dropdown ── */}
      <FilterDropdownPortal isOpen={showFilters === "bath"}>
        <style>{SLIDER_CSS}</style>
        <div className="fixed inset-0 z-[100]" onClick={() => setShowFilters(false)} />
        <div className="fixed z-[101]" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
          <div className="filter-dropdown bg-white border border-gray-200 rounded-xl shadow-xl p-6 w-80"
            onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-4">Bathrooms</h3>
            <div className="mb-6">
              <DualStepSlider
                steps={BATH_STEPS}
                minValue={filters.bathrooms || "1"}
                maxValue={filters.maxBathrooms || "4"}
                onMinChange={(v) => setFilters({ ...filters, bathrooms: v === "1" ? "" : v })}
                onMaxChange={(v) => setFilters({ ...filters, maxBathrooms: v === "4" ? "" : v })}
                onSnapTo={(v) => setFilters({ ...filters, bathrooms: v === "1" ? "" : v, maxBathrooms: v === "4" ? "" : v })}
              />
            </div>
            <div className="flex justify-between">
              <button onClick={() => setFilters({ ...filters, bathrooms: "", maxBathrooms: "" })} className="text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg text-sm">Reset</button>
              <button onClick={() => setShowFilters(false)} className="bg-red-500 text-white px-6 py-2 rounded-lg text-sm hover:bg-red-600">Done</button>
            </div>
          </div>
        </div>
      </FilterDropdownPortal>

      {/* ── More Filters modal ── */}
      <FilterDropdownPortal isOpen={showFilters === "more-filters"}>
        <style>{SLIDER_CSS}</style>
        <div className="fixed inset-0 bg-black bg-opacity-40 z-[100]" onClick={() => setShowFilters(false)} />
        <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
          <div
            className="filter-dropdown bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={handleFilterDropdownWheel}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Filters</h2>
              <button onClick={() => setShowFilters(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-6 py-5">
              <div className="grid grid-cols-2 gap-x-8 gap-y-6">

                {/* ── LEFT COLUMN ── */}
                <div className="space-y-6">

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
                            checked={draft.leaseAvailability?.includes(opt.value) || false}
                            onChange={() => toggleArray("leaseAvailability", opt.value)}
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
                      value={draft.moveInDate || ""}
                      onChange={(e) => setDraft({ ...draft, moveInDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
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
                            checked={draft.homeType?.includes(opt.value) || false}
                            onChange={() => toggleArray("homeType", opt.value)}
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
                        { label: "Dishwasher",    value: "dishwasher"    },
                        { label: "Extra Storage",  value: "extraStorage"  },
                        { label: "In-Unit Laundry",value: "inUnitLaundry" },
                        { label: "Fireplace",      value: "fireplace"     },
                        { label: "AC/Heating",     value: "gym"           },
                        { label: "Private Parking",value: "freeParking"   },
                        { label: "Mailroom",       value: "mailroom"      },
                        { label: "Pool",           value: "pool"          },
                        { label: "Pets Allowed",   value: "petsAllowed"   },
                        { label: "Study Rooms",    value: "studyRooms"    },
                        { label: "Gym / Fitness",  value: "gym"           },
                      ].filter((o, i, arr) => arr.findIndex(x => x.value === o.value) === i)
                       .map((opt) => (
                        <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.amenities?.includes(opt.value) || false}
                            onChange={() => toggleArray("amenities", opt.value)}
                            className="rounded border-gray-300 text-red-500 focus:ring-red-500 w-4 h-4 accent-red-500"
                          />
                          <span className="text-sm text-gray-700">{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  </FilterSection>
                </div>

                {/* ── RIGHT COLUMN ── */}
                <div className="space-y-6">

                  {/* Price Range */}
                  <div>
                    <p className="font-semibold text-gray-900 text-sm mb-3">Price Range</p>
                    <DualRangeSlider
                      minRent={draft.minRent}
                      maxRent={draft.maxRent}
                      draft={draft}
                      setDraft={setDraft}
                    />
                  </div>

                  {/* Bedrooms */}
                  <div>
                    <p className="font-semibold text-gray-900 text-sm mb-3">Bedrooms</p>
                    <DualStepSlider
                      steps={BED_STEPS}
                      minValue={draft.bedrooms || "0"}
                      maxValue={draft.maxBedrooms || "5"}
                      onMinChange={(v) => setDraft({ ...draft, bedrooms: v === "0" ? "" : v })}
                      onMaxChange={(v) => setDraft({ ...draft, maxBedrooms: v === "5" ? "" : v })}
                      onSnapTo={(v) => setDraft({ ...draft, bedrooms: v === "0" ? "" : v, maxBedrooms: v === "5" ? "" : v })}
                    />
                  </div>

                  {/* Bathrooms */}
                  <div>
                    <p className="font-semibold text-gray-900 text-sm mb-3">Bathrooms</p>
                    <DualStepSlider
                      steps={BATH_STEPS}
                      minValue={draft.bathrooms || "1"}
                      maxValue={draft.maxBathrooms || "4"}
                      onMinChange={(v) => setDraft({ ...draft, bathrooms: v === "1" ? "" : v })}
                      onMaxChange={(v) => setDraft({ ...draft, maxBathrooms: v === "4" ? "" : v })}
                      onSnapTo={(v) => setDraft({ ...draft, bathrooms: v === "1" ? "" : v, maxBathrooms: v === "4" ? "" : v })}
                    />
                  </div>

                  {/* Walking Distance to Campus */}
                  <div>
                    <p className="font-semibold text-gray-900 text-sm mb-3">Walking Distance to Campus</p>
                    <StepSlider
                      steps={DIST_STEPS}
                      value={draft.distance || ""}
                      onChange={(v) => setDraft({ ...draft, distance: v })}
                    />
                  </div>

                  {/* Walking Distance to Shuttle */}
                  <div>
                    <p className="font-semibold text-gray-900 text-sm mb-3">Walking Distance to Shuttle</p>
                    <StepSlider
                      steps={SHTT_STEPS}
                      value={draft.distanceToShuttle || ""}
                      onChange={(v) => setDraft({ ...draft, distanceToShuttle: v })}
                    />
                  </div>

                  {/* Furnished */}
                  <div>
                    <label className="block font-semibold text-gray-900 text-sm mb-2">Furnished</label>
                    <div className="relative">
                      <select
                        value={draft.furnished || ""}
                        onChange={(e) => setDraft({ ...draft, furnished: e.target.value })}
                        className="w-full appearance-none px-3 py-2 pr-8 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white"
                      >
                        <option value="">Any</option>
                        <option value="furnished">Furnished</option>
                        <option value="unfurnished">Unfurnished</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-gray-500">{CHEVRON}</div>
                    </div>
                  </div>

                  {/* Lease Structure */}
                  <div>
                    <label className="block font-semibold text-gray-900 text-sm mb-2">Lease Structure</label>
                    <div className="relative">
                      <select
                        value={draft.leaseStructure || ""}
                        onChange={(e) => setDraft({ ...draft, leaseStructure: e.target.value })}
                        className="w-full appearance-none px-3 py-2 pr-8 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white"
                      >
                        <option value="">Any</option>
                        <option value="individual">Individual Lease</option>
                        <option value="joint">Joint Lease</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-gray-500">{CHEVRON}</div>
                    </div>
                  </div>

                  {/* Boolean toggles */}
                  <div className="space-y-3">
                    {[
                      { label: "Utilities Included", field: "utilitiesIncluded" },
                      { label: "Sublease Friendly",  field: "subleaseFriendly"  },
                    ].map(({ label, field }) => (
                      <label key={field} className="flex items-center justify-between cursor-pointer">
                        <span className="text-sm font-medium text-gray-700">{label}</span>
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, [field]: !draft[field] })}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${draft[field] ? "bg-red-500" : "bg-gray-200"}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${draft[field] ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <button
                onClick={() => { onReset(); setDraft({}); }}
                className="text-sm font-medium text-gray-600 hover:text-red-600 transition-colors"
              >
                Reset all
              </button>
              <button
                onClick={() => { setFilters(draft); setShowFilters(false); }}
                className="px-8 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-full text-sm transition-colors shadow-md"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      </FilterDropdownPortal>
    </>
  );
}
