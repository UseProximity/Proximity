"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Portal component for filter dropdowns
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

export default function ListingFilters({ filters, setFilters, onReset }) {
  const [showFilters, setShowFilters] = useState(false); // false, 'price', 'beds-baths', 'more-filters'
  const filterRef = useRef(null);

  // Custom wheel event handler for filter dropdowns
  const handleFilterDropdownWheel = (e) => {
    const dropdown = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = dropdown;

    // Check if the dropdown is at the top or bottom
    const isAtTop = scrollTop <= 0;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight;

    // Prevent scrolling the page when at the top or bottom of the dropdown
    if ((e.deltaY < 0 && isAtTop) || (e.deltaY > 0 && isAtBottom)) {
      e.preventDefault();
    }
  };

  // Close filter dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Don't close if clicking on any filter dropdown content
      if (event.target.closest(".filter-dropdown")) {
        return;
      }

      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setShowFilters(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Prevent page scroll when filter dropdowns are open
  useEffect(() => {
    if (showFilters && showFilters !== false) {
      const originalStyle = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [showFilters]);

  return (
    <>
      {/* Filter Buttons Row */}
      <div ref={filterRef} className="flex gap-2 sm:gap-4 mb-6 w-full">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowFilters(showFilters === "price" ? false : "price");
          }}
          className="flex items-center justify-center gap-1.5 sm:gap-2 flex-1 px-2 sm:px-5 py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm sm:text-base"
        >
          <span>Price</span>
          <svg
            className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowFilters(showFilters === "beds-baths" ? false : "beds-baths");
          }}
          className="flex items-center justify-center gap-1.5 sm:gap-2 flex-1 px-2 sm:px-5 py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm sm:text-base"
        >
          <span>Beds/baths</span>
          <svg
            className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowFilters(
              showFilters === "more-filters" ? false : "more-filters"
            );
          }}
          className="flex items-center justify-center gap-1.5 sm:gap-2 flex-1 px-2 sm:px-5 py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm sm:text-base"
        >
          <span>More filters</span>
          <svg
            className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        <button
          onClick={onReset}
          className="flex items-center justify-center gap-1.5 sm:gap-2 flex-1 px-2 sm:px-5 py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm sm:text-base"
        >
          <span>Clear All</span>
        </button>
      </div>

      {/* Price Filter Dropdown */}
      <FilterDropdownPortal isOpen={showFilters === "price"}>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black bg-opacity-25 z-[100]"
          onClick={() => setShowFilters(false)}
        />
        <div className="fixed inset-0 z-[101] flex items-start justify-start p-4 pt-32">
          <div
            className="filter-dropdown bg-white border border-gray-200 rounded-lg shadow-xl p-6 max-h-[80vh] overflow-y-auto"
            style={{ width: "500px" }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={handleFilterDropdownWheel}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Price</h3>

            {/* Price Chart */}
            <div className="mb-6">
              <div className="flex items-end justify-center h-24 space-x-1 mb-4">
                {[
                  2, 4, 6, 8, 12, 15, 18, 20, 16, 14, 12, 10, 8, 6, 4, 3, 2,
                  1, 1, 1,
                ].map((height, index) => (
                  <div
                    key={index}
                    className="bg-red-500 rounded-sm"
                    style={{
                      width: "16px",
                      height: `${height * 3}px`,
                      opacity: 0.8,
                    }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-sm text-gray-600 mb-4">
                <span>$400</span>
                <span>$5,000+</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <input
                type="number"
                placeholder="Enter min"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                value={filters.minRent}
                onChange={(e) => {
                  e.stopPropagation();
                  setFilters({ ...filters, minRent: e.target.value });
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
              />
              <input
                type="number"
                placeholder="Enter max"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                value={filters.maxRent}
                onChange={(e) => {
                  e.stopPropagation();
                  setFilters({ ...filters, maxRent: e.target.value });
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
              />
            </div>

            <div className="flex justify-between">
              <button
                onClick={onReset}
                className="px-6 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                Reset
              </button>
              <button
                onClick={() => setShowFilters(false)}
                className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </FilterDropdownPortal>

      {/* Beds/Baths Filter Dropdown */}
      <FilterDropdownPortal isOpen={showFilters === "beds-baths"}>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black bg-opacity-25 z-[100]"
          onClick={() => setShowFilters(false)}
        />
        <div className="fixed inset-0 z-[101] flex items-start justify-start p-4 pt-32">
          <div
            className="filter-dropdown bg-white border border-gray-200 rounded-lg shadow-xl p-6 max-h-[80vh] overflow-y-auto"
            style={{ width: "400px" }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={handleFilterDropdownWheel}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Beds & Baths
            </h3>

            <div className="mb-6">
              <h4 className="text-md font-medium text-gray-900 mb-3">Beds</h4>
              <p className="text-sm text-gray-600 mb-3">
                Tap two numbers to select a range
              </p>
              <div className="grid grid-cols-7 gap-2 mb-6">
                {["Any", "0", "1", "2", "3", "4", "5+"].map((option) => (
                  <button
                    key={option}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (option === "Any") {
                        setFilters({ ...filters, bedrooms: "" });
                      } else if (option === "0br") {
                        setFilters({ ...filters, bedrooms: "0" });
                      } else {
                        setFilters({
                          ...filters,
                          bedrooms: option.replace("+", ""),
                        });
                      }
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${
                      (option === "Any" && !filters.bedrooms) ||
                      (option === "0br" && filters.bedrooms === "0") ||
                      (option !== "Any" &&
                        option !== "0br" &&
                        filters.bedrooms === option.replace("+", ""))
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <h4 className="text-md font-medium text-gray-900 mb-3">
                Baths
              </h4>
              <div className="grid grid-cols-7 gap-2">
                {["Any", "1+", "1.5+", "2+", "2.5+", "3+", "4+"].map(
                  (option) => (
                    <button
                      key={option}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setFilters({
                          ...filters,
                          bathrooms:
                            option === "Any" ? "" : option.replace("+", ""),
                        });
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className={`px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${
                        (option === "Any" && !filters.bathrooms) ||
                        (option !== "Any" &&
                          filters.bathrooms === option.replace("+", ""))
                          ? "bg-red-600 text-white border-red-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {option}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={onReset}
                className="px-6 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                Reset
              </button>
              <button
                onClick={() => setShowFilters(false)}
                className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </FilterDropdownPortal>

      {/* More Filters Dropdown */}
      <FilterDropdownPortal isOpen={showFilters === "more-filters"}>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black bg-opacity-25 z-[100] overflow-hidden"
          onClick={() => setShowFilters(false)}
        />
        <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 overflow-hidden">
          <div
            className="filter-dropdown bg-white border border-gray-200 rounded-lg shadow-xl max-h-[90vh] overflow-y-auto w-full max-w-3xl"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={handleFilterDropdownWheel}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 p-3 pb-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  More Filters
                </h3>
                <button
                  onClick={() => setShowFilters(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-3 space-y-3">
              {/* I Want to Rent Section */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                  I Want to Rent
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { label: "The Entire Unit", value: "entire" },
                    { label: "A Room", value: "room" },
                    { label: "Dorm Room", value: "dorm-room" },
                    { label: "Suite in Dorm", value: "suite" },
                    { label: "Exclude Sublets", value: "no-sublets" },
                    { label: "Sublets Only", value: "sublets-only" },
                    {
                      label: "A Property with Move-in Specials",
                      value: "move-in-specials",
                    },
                    { label: "On-Campus Housing", value: "on-campus" },
                    { label: "University Housing", value: "university" },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center space-x-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={
                          filters.rentType?.includes(option.value) || false
                        }
                        onChange={(e) => {
                          e.stopPropagation();
                          const currentTypes = filters.rentType || [];
                          const newTypes = e.target.checked
                            ? [...currentTypes, option.value]
                            : currentTypes.filter((t) => t !== option.value);
                          setFilters({ ...filters, rentType: newTypes });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="rounded border-gray-300 text-red-500 focus:ring-red-500"
                      />
                      <span className="text-gray-700 text-sm">
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Move-in Options */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                  Move-in Options
                </h4>
                <div className="space-y-2">
                  {[
                    { label: "Any", value: "any" },
                    { label: "Move-in now", value: "now" },
                    { label: "Move-in During a Month", value: "month" },
                    { label: "Move-in Between Range", value: "range" },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center space-x-2 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="moveInOption"
                        checked={
                          filters.moveInOption === option.value ||
                          (!filters.moveInOption && option.value === "any")
                        }
                        onChange={(e) => {
                          e.stopPropagation();
                          setFilters({
                            ...filters,
                            moveInOption:
                              option.value === "any" ? "" : option.value,
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="text-red-500 focus:ring-red-500"
                      />
                      <span className="text-gray-700 text-xs">
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Lease Information */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                  Lease Information
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { label: "9 Month Lease", value: "9 Month Lease" },
                    { label: "12 Month Lease", value: "12-month" },
                    { label: "Fall Sublet", value: "fall-sublet" },
                    { label: "Short-Term Lease", value: "short-term" },
                    { label: "Semester Lease", value: "semester" },
                    { label: "Winter Sublet", value: "winter-sublet" },
                    { label: "Individual Leases", value: "individual" },
                    {
                      label: "Month-to-Month Lease",
                      value: "month-to-month",
                    },
                    { label: "Spring Sublet", value: "spring-sublet" },
                    { label: "2-Year Lease", value: "2-year" },
                    { label: "Academic Year", value: "academic-year" },
                    { label: "Summer Sublet", value: "summer-sublet" },
                    { label: "Flexible Leases", value: "flexible" },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center space-x-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={
                          filters.leaseInfo?.includes(option.value) || false
                        }
                        onChange={(e) => {
                          e.stopPropagation();
                          const currentLeases = filters.leaseInfo || [];
                          const newLeases = e.target.checked
                            ? [...currentLeases, option.value]
                            : currentLeases.filter((l) => l !== option.value);
                          setFilters({ ...filters, leaseInfo: newLeases });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="rounded border-gray-300 text-red-500 focus:ring-red-500"
                      />
                      <span className="text-gray-700 text-sm">
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Distance to Campus */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                  Walking Distance to Campus
                </h4>
                <select
                  value={filters.distance || ""}
                  onChange={(e) => {
                    e.stopPropagation();
                    setFilters({ ...filters, distance: e.target.value });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                >
                  <option value="">Any</option>
                  <option value="10">Within 10 min walk</option>
                  <option value="15">Within 15 min walk</option>
                  <option value="20">Within 20 min walk</option>
                  <option value="30">Within 30 min walk</option>
                  <option value="45">Within 45 min walk</option>
                </select>
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 bg-white border-t border-gray-200 p-3 flex justify-between">
                <button
                  onClick={onReset}
                  className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium text-sm"
                >
                  Reset all
                </button>
                <button
                  onClick={() => setShowFilters(false)}
                  className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium text-sm"
                >
                  See results
                </button>
              </div>
            </div>
          </div>
        </div>
      </FilterDropdownPortal>
    </>
  );
}
