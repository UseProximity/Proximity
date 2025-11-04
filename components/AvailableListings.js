"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import Modal from "@/components/Modal";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

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

function HeartIcon({ userId, listingId, initial = false }) {
  const [isFavorite, setIsFavorite] = useState(initial);
  const [pending, setPending] = useState(false);

  // keep local state in sync when `initial` changes (e.g. after user fetch)
  useEffect(() => {
    setIsFavorite(initial);
  }, [initial]);

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending || userId == "") return; // TODO: handle user not logged in (maybe show login modal)
    console.log("A passar");

    const prev = isFavorite;
    const next = !prev;

    // Optimistic UI
    console.log("Optimistically setting favorite to:", next);
    setIsFavorite(next);
    setPending(true);

    try {
      if (!userId) {
        console.log("UserId:", userId);
        console.log("User ID not available, rolling back favorite state");
        setIsFavorite(prev);
        return;
      }

      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, userId }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || typeof data.favorited !== "boolean") {
        // Roll back if server failed/invalid response
        setIsFavorite(prev);
        return;
      }

      // Snap to server truth
      setIsFavorite(data.favorited);
    } catch (err) {
      console.error("Could not update favorites:", err);
      setIsFavorite(prev); // Roll back on error
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      aria-disabled={pending}
      aria-busy={pending}
      className="focus:outline-none p-1.5 hover:text-red-500 transition-all disabled:opacity-60"
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={isFavorite}
    >
      {isFavorite ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="red"
          viewBox="0 0 24 24"
          className="h-6 w-6"
        >
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          className="h-6 w-6"
        >
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      )}
    </button>
  );
}

export default function AvailableListings({
  session,
  listings,
  onClearSearch,
}) {
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false); // can be false, 'price', 'beds-baths', 'home-type', or 'all'
  const filterRef = useRef(null);
  const [user, setUser] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false); // State for modal visibility

  const fetchUser = useCallback(async () => {
    try {
      if (!session) return;
      const response = await fetch(`/api/getUser`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user: ${response.statusText}`);
      }

      setUser(await response.json());
    } catch (error) {
      console.error("Error fetching User:", error);
    }
  }, [session]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

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
      // Disable body scroll by setting overflow to hidden
      const originalStyle = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      return () => {
        // Restore original overflow style when filters are closed
        document.body.style.overflow = originalStyle;
      };
    }
  }, [showFilters]);

  const [filters, setFilters] = useState({
    minRent: "",
    maxRent: "",
    bedrooms: "",
    bathrooms: "",
    leaseType: "",
    minArea: "",
    maxArea: "",
    distance: "",
    moveInDate: "",
    petPolicy: "",
    amenities: [],
    rentType: [],
    moveInOption: "",
    leaseInfo: [],
    transportation: [],
    pets: [],
    unitFeatures: [],
    communityFeatures: [],
    laundry: [],
    security: [],
  });

  // WashU coordinates for distance calculation
  const WASHU_COORDS = { lat: 38.6496, lng: -90.3035 };

  // Calculate distance from listing to WashU campus
  const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLng = (lng2 - lng1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const handleReset = () => {
    setSearch("");
    setFilters({
      minRent: "",
      maxRent: "",
      bedrooms: "",
      bathrooms: "",
      leaseType: "",
      minArea: "",
      maxArea: "",
      distance: "",
      moveInDate: "",
      petPolicy: "",
      amenities: [],
      rentType: [],
      moveInOption: "",
      leaseInfo: [],
      transportation: [],
      pets: [],
      unitFeatures: [],
      communityFeatures: [],
      laundry: [],
      security: [],
    });

    // Also clear the search from the URL and reset filtered listings
    if (onClearSearch) {
      onClearSearch();
    }
  };

  const filteredListings = listings.filter((listing) => {
    const matchSearch = listing.address
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchMinRent =
      !filters.minRent || listing.rent >= Number(filters.minRent);
    const matchMaxRent =
      !filters.maxRent || listing.rent <= Number(filters.maxRent);
    const matchBeds =
      !filters.bedrooms || listing.bedrooms >= Number(filters.bedrooms);
    const matchBaths =
      !filters.bathrooms || listing.bathrooms >= Number(filters.bathrooms);
    const matchLease =
      !filters.leaseType || listing.leaseType === filters.leaseType;
    const matchMinArea =
      !filters.minArea || listing.area >= Number(filters.minArea);
    const matchMaxArea =
      !filters.maxArea || listing.area <= Number(filters.maxArea);

    // Distance filter
    let matchDistance = true;
    if (filters.distance && listing.latitude && listing.longitude) {
      const distance = calculateDistance(
        listing.latitude,
        listing.longitude,
        WASHU_COORDS.lat,
        WASHU_COORDS.lng
      );
      const maxDistance = parseFloat(filters.distance);
      matchDistance = distance <= maxDistance;
    }

    // Pet policy filter
    let matchPetPolicy = true;
    if (filters.petPolicy) {
      // This would need to be implemented based on your listing data structure
      // For now, we'll assume all listings match
      matchPetPolicy = true;
    }

    // Amenities filter
    let matchAmenities = true;
    if (filters.amenities && filters.amenities.length > 0) {
      // This would need to be implemented based on your listing data structure
      // For now, we'll assume all listings match
      matchAmenities = true;
    }

    // Move-in date filter
    let matchMoveInDate = true;
    if (filters.moveInDate) {
      // This would need to be implemented based on your listing data structure
      // For now, we'll assume all listings match
      matchMoveInDate = true;
    }

    return (
      matchSearch &&
      matchMinRent &&
      matchMaxRent &&
      matchBeds &&
      matchBaths &&
      matchLease &&
      matchMinArea &&
      matchMaxArea &&
      matchDistance &&
      matchPetPolicy &&
      matchAmenities &&
      matchMoveInDate
    );
  });

  return (
    <>
      {/* Listings Section */}
      <div className="md:w-1/2 w-full overflow-y-auto px-4 py-8">
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <input
            type="text"
            placeholder="Search by street name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:border-red-600 transition-colors"
          />
        </div>
        {/* Filter Buttons Row */}
        <div ref={filterRef} className="flex gap-3 mb-6">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowFilters(showFilters === "price" ? false : "price");
            }}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <span>Price</span>
            <svg
              className="w-4 h-4"
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
                showFilters === "beds-baths" ? false : "beds-baths"
              );
            }}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <span>Beds/baths</span>
            <svg
              className="w-4 h-4"
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
              setShowFilters(showFilters === "home-type" ? false : "home-type");
            }}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <span>Home type</span>
            <svg
              className="w-4 h-4"
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
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <span>More filters</span>
            <svg
              className="w-4 h-4"
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
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
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
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Price
              </h3>

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
                  onClick={handleReset}
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
                  onClick={handleReset}
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

        {/* Home Type Filter Dropdown */}
        <FilterDropdownPortal isOpen={showFilters === "home-type"}>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-25 z-[100]"
            onClick={() => setShowFilters(false)}
          />
          <div className="fixed inset-0 z-[101] flex items-start justify-start p-4 pt-32">
            <div
              className="filter-dropdown bg-white border border-gray-200 rounded-lg shadow-xl p-6 max-h-[80vh] overflow-y-auto"
              style={{ width: "300px" }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onWheel={handleFilterDropdownWheel}
              onTouchMove={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Home Type
              </h3>

              <div className="space-y-3 mb-6">
                {[
                  "Apartment",
                  "House",
                  "Townhouse",
                  "Condo",
                  "Studio",
                  "Dorm",
                  "Residence Hall",
                  "Suite-Style Dorm",
                  "Traditional Dorm",
                ].map((type) => (
                  <label
                    key={type}
                    className="flex items-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="mr-3 h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                      checked={filters.leaseType === type}
                      onChange={(e) => {
                        e.stopPropagation();
                        setFilters({
                          ...filters,
                          leaseType: e.target.checked ? type : "",
                        });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                    <span className="text-gray-700">{type}</span>
                  </label>
                ))}
              </div>

              <div className="flex justify-between">
                <button
                  onClick={handleReset}
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

                {/* Dorm Types */}
                <div>
                  <h4 className="text-base font-semibold text-gray-900 mb-3">
                    Dorm Types
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {[
                      {
                        label: "Traditional Double",
                        value: "traditional-double",
                      },
                      { label: "Modern Double", value: "modern-double" },
                      {
                        label: "Traditional Single",
                        value: "traditional-single",
                      },
                      { label: "Modern Single", value: "modern-single" },
                      { label: "Suite-Style", value: "suite-style" },
                      { label: "Apartment-Style", value: "apartment-style" },
                      { label: "Freshman Dorms", value: "freshman" },
                      {
                        label: "Upperclassman Dorms",
                        value: "upperclassman",
                      },
                      { label: "Co-ed Dorms", value: "co-ed" },
                      {
                        label: "Single-Gender Dorms",
                        value: "single-gender",
                      },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className="flex items-center space-x-2 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={
                            filters.dormTypes?.includes(option.value) || false
                          }
                          onChange={(e) => {
                            e.stopPropagation();
                            const currentTypes = filters.dormTypes || [];
                            const newTypes = e.target.checked
                              ? [...currentTypes, option.value]
                              : currentTypes.filter((t) => t !== option.value);
                            setFilters({ ...filters, dormTypes: newTypes });
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
                      { label: "12-Month Lease", value: "12-month" },
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
                    Distance to Campus
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
                    <option value="0.5">Within 0.5 miles</option>
                    <option value="1">Within 1 mile</option>
                    <option value="2">Within 2 miles</option>
                    <option value="5">Within 5 miles</option>
                  </select>
                </div>

                {/* Transportation & Pets */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">
                      Transportation
                    </h4>
                    <div className="space-y-2">
                      {[
                        {
                          label: "Near Campus Shuttle Route",
                          value: "shuttle",
                        },
                        { label: "Near Bus Stop", value: "bus" },
                        { label: "Near Metro or Subway", value: "metro" },
                        { label: "Garage Parking", value: "garage" },
                        {
                          label: "Private Shuttle to Campus",
                          value: "private-shuttle",
                        },
                        { label: "Walk to Campus", value: "walk" },
                      ].map((option) => (
                        <label
                          key={option.value}
                          className="flex items-center space-x-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={
                              filters.transportation?.includes(option.value) ||
                              false
                            }
                            onChange={(e) => {
                              e.stopPropagation();
                              const currentTransport =
                                filters.transportation || [];
                              const newTransport = e.target.checked
                                ? [...currentTransport, option.value]
                                : currentTransport.filter(
                                    (t) => t !== option.value
                                  );
                              setFilters({
                                ...filters,
                                transportation: newTransport,
                              });
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

                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">
                      Pets
                    </h4>
                    <div className="space-y-2">
                      {[
                        { label: "Dogs", value: "dogs" },
                        { label: "Cats", value: "cats" },
                        { label: "Pets Allowed", value: "allowed" },
                        { label: "Pets Not Allowed", value: "not-allowed" },
                      ].map((option) => (
                        <label
                          key={option.value}
                          className="flex items-center space-x-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={
                              filters.pets?.includes(option.value) || false
                            }
                            onChange={(e) => {
                              e.stopPropagation();
                              const currentPets = filters.pets || [];
                              const newPets = e.target.checked
                                ? [...currentPets, option.value]
                                : currentPets.filter((p) => p !== option.value);
                              setFilters({ ...filters, pets: newPets });
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
                </div>

                {/* Unit Features */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">
                    Unit Features
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { label: "Air Conditioning", value: "ac" },
                      { label: "Disability Accessible", value: "accessible" },
                      { label: "Dishwasher", value: "dishwasher" },
                      { label: "Storage Space", value: "storage" },
                      { label: "Fireplace", value: "fireplace" },
                      { label: "Furnished", value: "furnished" },
                      { label: "Hardwood Floors", value: "hardwood" },
                      { label: "High-Speed Internet", value: "internet" },
                      { label: "Loft", value: "loft" },
                      { label: "Outdoor Rec Space", value: "outdoor" },
                      {
                        label: "Patio, Balcony, Porch or Deck",
                        value: "patio",
                      },
                      { label: "Smoke-Free", value: "smoke-free" },
                      { label: "Utilities Included", value: "utilities" },
                      { label: "Wheelchair Accessible", value: "wheelchair" },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className="flex items-center space-x-2 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={
                            filters.unitFeatures?.includes(option.value) ||
                            false
                          }
                          onChange={(e) => {
                            e.stopPropagation();
                            const currentFeatures = filters.unitFeatures || [];
                            const newFeatures = e.target.checked
                              ? [...currentFeatures, option.value]
                              : currentFeatures.filter(
                                  (f) => f !== option.value
                                );
                            setFilters({
                              ...filters,
                              unitFeatures: newFeatures,
                            });
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

                {/* Community Features */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">
                    Community Features
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { label: "Alcohol-Free", value: "alcohol-free" },
                      { label: "Elevator", value: "elevator" },
                      { label: "Family Friendly", value: "family" },
                      { label: "Fitness Room", value: "fitness" },
                      {
                        label: "International Student Friendly",
                        value: "international",
                      },
                      { label: "On-Campus Housing", value: "on-campus" },
                      { label: "Pool", value: "pool" },
                      { label: "Roommate Matching", value: "roommate" },
                      { label: "Study Lounges", value: "study" },
                      { label: "University Housing", value: "university" },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className="flex items-center space-x-2 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={
                            filters.communityFeatures?.includes(option.value) ||
                            false
                          }
                          onChange={(e) => {
                            e.stopPropagation();
                            const currentFeatures =
                              filters.communityFeatures || [];
                            const newFeatures = e.target.checked
                              ? [...currentFeatures, option.value]
                              : currentFeatures.filter(
                                  (f) => f !== option.value
                                );
                            setFilters({
                              ...filters,
                              communityFeatures: newFeatures,
                            });
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

                {/* Laundry & Security */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">
                      Laundry
                    </h4>
                    <div className="space-y-2">
                      {[
                        { label: "Community Laundry", value: "community" },
                        { label: "Washer/Dryer Hookups", value: "hookups" },
                        { label: "Washer/Dryer In Unit", value: "in-unit" },
                        { label: "Laundry Access", value: "access" },
                      ].map((option) => (
                        <label
                          key={option.value}
                          className="flex items-center space-x-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={
                              filters.laundry?.includes(option.value) || false
                            }
                            onChange={(e) => {
                              e.stopPropagation();
                              const currentLaundry = filters.laundry || [];
                              const newLaundry = e.target.checked
                                ? [...currentLaundry, option.value]
                                : currentLaundry.filter(
                                    (l) => l !== option.value
                                  );
                              setFilters({ ...filters, laundry: newLaundry });
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

                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">
                      Security
                    </h4>
                    <div className="space-y-2">
                      {[
                        { label: "Courtesy Officer/Patrol", value: "patrol" },
                        { label: "Gated Community", value: "gated" },
                        { label: "Security System", value: "system" },
                        { label: "Dead-Bolt Locks", value: "deadbolt" },
                      ].map((option) => (
                        <label
                          key={option.value}
                          className="flex items-center space-x-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={
                              filters.security?.includes(option.value) || false
                            }
                            onChange={(e) => {
                              e.stopPropagation();
                              const currentSecurity = filters.security || [];
                              const newSecurity = e.target.checked
                                ? [...currentSecurity, option.value]
                                : currentSecurity.filter(
                                    (s) => s !== option.value
                                  );
                              setFilters({
                                ...filters,
                                security: newSecurity,
                              });
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
                </div>
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 bg-white border-t border-gray-200 p-3 flex justify-between">
                <button
                  onClick={handleReset}
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
        </FilterDropdownPortal>

        {filteredListings.length === 0 ? (
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
              We couldn&apos;t find any listings matching your criteria. Try
              adjusting your filters or search terms.
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
        ) : (
          <div className="grid grid-cols-2 gap-6">
            {filteredListings.map((listing) => (
              <div
                key={listing._id}
                className="relative group bg-white rounded-2xl shadow-lg transition-colors duration-200 overflow-hidden border border-gray-100 hover:border-red-200"
              >
                <a href={`/browse/${listing._id}`}>
                  <div className="relative">
                    <img
                      src={listing.images[0]}
                      alt=""
                      className="w-full h-48 object-cover"
                    />
                  </div>
                  <div className="p-5 bg-gradient-to-br from-gray-50/50 to-white">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold text-2xl text-black">
                        ${listing.rent.toLocaleString()}
                        <span className="text-sm font-normal">/month</span>
                      </h3>
                    </div>
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="flex items-center space-x-1 bg-gradient-to-r from-emerald-50 to-red-50 border border-emerald-200 px-3 py-1.5 rounded-full shadow-sm">
                        <span className="text-emerald-700 font-semibold text-sm">
                          {listing.bedrooms}
                        </span>
                        <span className="text-emerald-600 text-xs">bd</span>
                      </div>
                      <div className="flex items-center space-x-1 bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-200 px-3 py-1.5 rounded-full shadow-sm">
                        <span className="text-rose-700 font-semibold text-sm">
                          {listing.bathrooms}
                        </span>
                        <span className="text-rose-600 text-xs">ba</span>
                      </div>
                      <div className="flex items-center space-x-1 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 px-3 py-1.5 rounded-full shadow-sm">
                        <span className="text-amber-700 font-semibold text-sm">
                          {listing.area}
                        </span>
                        <span className="text-amber-600 text-xs">sqft</span>
                      </div>
                    </div>
                    <div className="flex items-start space-x-2 bg-gray-50 rounded-lg p-3 border border-gray-100">
                      <svg
                        className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <p className="text-sm text-gray-700 leading-relaxed font-medium">
                        {listing.address}
                      </p>
                    </div>
                  </div>
                </a>

                <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-red-600 transition-[width] duration-300 group-hover:w-full" />
                <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full p-2 shadow-xl border border-white/50">
                  <HeartIcon
                    userId={user?._id || ""}
                    listingId={listing._id}
                    initial={
                      Boolean(user) &&
                      Boolean(
                        user?.favorites?.some(
                          (f) =>
                            String((f && f._id) || f) === String(listing._id)
                        ) || user?.favoritesIds?.includes(String(listing._id))
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && selectedListing && (
        <Modal isOpen={isModalOpen} onClose={handleCloseModal}>
          <div className="p-6">
            <h2 className="text-2xl font-bold mb-4">
              {selectedListing.address}
            </h2>
            <img
              src={selectedListing.images[0]}
              alt={selectedListing.address}
              className="w-full h-64 object-cover rounded-lg mb-4"
            />
            <p className="text-lg">
              Rent: <strong>${selectedListing.rent.toLocaleString()}</strong>
            </p>
            <p className="text-lg">
              Bedrooms: <strong>{selectedListing.bedrooms}</strong>
            </p>
            <p className="text-lg">
              Bathrooms: <strong>{selectedListing.bathrooms}</strong>
            </p>
            <p className="text-gray-700 mt-4">{selectedListing.description}</p>
          </div>
        </Modal>
      )}

      {/* Map Section */}
      <div className="md:w-1/2 w-full h-64 md:h-full relative">
        <MapView
          listings={filteredListings}
          filters={filters}
          setFilters={setFilters}
          handleReset={handleReset}
        />
      </div>
    </>
  );
}
