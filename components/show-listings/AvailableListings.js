"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import ModalListing from "@/components/show-listings/ModalListing";
import ListingModalInfo from "@/components/show-listings/ListingModalInfo";
import { signIn } from "next-auth/react";
import ListingFilters from "@/components/show-listings/ListingFilters";
import {
  getAreaRangeLabel,
  getRentRangeLabel,
  getUnitValuesLabel,
} from "@/utils/listingFormatters";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

function HeartIcon({ session, listingId, initial = false }) {
  const [isFavorite, setIsFavorite] = useState(initial);
  const [pending, setPending] = useState(false);

  // keep local state in sync when `initial` changes (e.g. after user fetch)
  useEffect(() => {
    setIsFavorite(initial);
  }, [initial]);

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;

    if (!session) {
      signIn(undefined, { callbackUrl: "/browse" });
    }

    const prev = isFavorite;
    const next = !prev;

    // Optimistic UI
    console.log("Optimistically setting favorite to:", next);
    setIsFavorite(next);
    setPending(true);

    try {
      if (!session?.user?.id) {
        console.log("User ID not available, rolling back favorite state");
        setIsFavorite(prev);
        return;
      }

      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, userId: session?.user?.id }),
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
  // WashU coordinates for distance calculation
  const WASHU_COORDS = { lat: 38.6496, lng: -90.3035 };

  const [search, setSearch] = useState("");

  const router = useRouter(); // both of these variables are for URL search params (when going from a different page to a specific listing here on browse)
  const searchParams = useSearchParams();

  /* ------------- Variables and functions for Listing Modal -------------------------------------------*/

  const [isModalOpen, setIsModalOpen] = useState(false); // State for modal visibility
  const [modalData, setModalData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Modified handleListingClick: accepts updateUrl flag
  const handleListingClick = async (listingId, updateUrl = true) => {
    if (!listingId) return;
    setIsLoading(true);
    setIsModalOpen(true);

    try {
      const response = await fetch(`/api/listing/${listingId}`);
      if (response.ok) {
        const data = await response.json();
        setModalData(data);

        // only push the URL when this action originates locally
        if (updateUrl) {
          // adds a history entry so Back will return to previous page
          router.push(`/browse?listing=${listingId}`);
        }
      } else {
        console.error("Failed to fetch listing data");
      }
    } catch (error) {
      console.error("Error fetching listing data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloseModal = () => {
    // remove the listing param without adding another history entry
    router.replace("/browse");
    setIsModalOpen(false);
    setModalData(null);
  };

  // Open modal if URL contains ?listing=ID
  useEffect(() => {
    const listingId = searchParams?.get("listing");
    if (listingId) {
      // avoid duplicate fetches if the modal already has that listing
      if (!isModalOpen || modalData?._id !== listingId) {
        // call but DO NOT update the URL (it's already in the URL)
        handleListingClick(listingId, /* updateUrl */ false);
      }
    } else {
      // if param removed and modal open, close it
      if (isModalOpen) {
        setIsModalOpen(false);
        setModalData(null);
      }
    }
    // Re-run when the query string changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams?.toString()]);

  /* ---------------- End variables and fucntions for Listing Modal ------------------------------*/

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
      !filters.minRent ||
      listing.unitTypes[0].rent >= Number(filters.unitTypes[0].minRent);
    const matchMaxRent =
      !filters.maxRent ||
      listing.unitTypes[0].rent <= Number(filters.unitTypes[0].maxRent);
    const matchBeds =
      !filters.bedrooms ||
      listing.unitTypes[0].bedrooms >= Number(filters.unitTypes[0].bedrooms);
    const matchBaths =
      !filters.bathrooms ||
      listing.unitTypes[0].bathrooms >= Number(filters.unitTypes[0].bathrooms);
    const matchLease =
      !filters.leaseType || listing.leaseType === filters.leaseType;
    const matchMinArea =
      !filters.minArea ||
      listing.unitTypes[0].area >= Number(filters.unitTypes[0].minArea);
    const matchMaxArea =
      !filters.maxArea ||
      listing.unitTypes[0].area <= Number(filters.unitTypes[0].maxArea);

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

      // Round to 2 decimal places to match displayed distance
      const roundedDistance = Math.round(distance * 100) / 100;
      matchDistance = roundedDistance <= maxDistance;

      console.log("Distance filter check:", {
        address: listing.address,
        rawDistance: distance,
        roundedDistance: roundedDistance.toFixed(2),
        maxDistance,
        matchDistance,
      });
    }

    // "I Want to Rent" filter - rentType
    let matchRentType = true;
    if (filters.rentType && filters.rentType.length > 0) {
      const leaseTypeLower = listing.leaseType?.toLowerCase() || "";
      const descriptionLower = listing.description?.toLowerCase() || "";

      matchRentType = filters.rentType.some((type) => {
        switch (type) {
          case "entire":
            return (
              leaseTypeLower.includes("apartment") ||
              leaseTypeLower.includes("house") ||
              leaseTypeLower.includes("condo") ||
              leaseTypeLower.includes("townhouse")
            );
          case "room":
            return (
              leaseTypeLower.includes("room") &&
              !leaseTypeLower.includes("dorm")
            );
          case "dorm-room":
            return (
              leaseTypeLower.includes("dorm") ||
              leaseTypeLower.includes("residence hall")
            );
          case "suite":
            return leaseTypeLower.includes("suite");
          case "no-sublets":
            return (
              !leaseTypeLower.includes("sublet") &&
              !descriptionLower.includes("sublet")
            );
          case "sublets-only":
            return (
              leaseTypeLower.includes("sublet") ||
              descriptionLower.includes("sublet")
            );
          case "move-in-specials":
            return (
              descriptionLower.includes("special") ||
              descriptionLower.includes("deal")
            );
          case "on-campus":
            return (
              leaseTypeLower.includes("on-campus") ||
              descriptionLower.includes("on campus")
            );
          case "university":
            return (
              leaseTypeLower.includes("university") ||
              descriptionLower.includes("university housing")
            );
          default:
            return true;
        }
      });
    }

    // Lease Information filter - leaseInfo
    let matchLeaseInfo = true;
    if (filters.leaseInfo && filters.leaseInfo.length > 0) {
      const leaseTypeLower = listing.leaseType?.toLowerCase() || "";
      const descriptionLower = listing.description?.toLowerCase() || "";

      matchLeaseInfo = filters.leaseInfo.some((info) => {
        const infoLower = info.toLowerCase();

        // Normalize both strings (replace dashes with spaces)
        const normalizedInfo = infoLower.replace(/-/g, " ");
        const normalizedLeaseType = leaseTypeLower.replace(/-/g, " ");

        // Check if lease type contains the filter value
        return normalizedLeaseType.includes(normalizedInfo);
      });
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
      matchRentType &&
      matchLeaseInfo
    );
  });

  return (
    <>
      {/* Listings Section */}
      <div
        className="md:w-1/2 w-full overflow-y-auto px-4 py-8"
        style={{ height: "100%", minHeight: 0 }}
      >
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <input
            type="text"
            placeholder="Search by street name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:border-red-600 transition-colors"
          />
        </div>
        <ListingFilters
          filters={filters}
          setFilters={setFilters}
          onReset={handleReset}
        />

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
            {filteredListings.map((listing) => {
              const imageUrl = listing.images?.[0];
              const imageCount = listing.images?.length || 0;

              return (
                <div
                  key={listing._id}
                  className="relative group bg-white rounded-2xl shadow-lg transition-colors duration-200 overflow-hidden border border-gray-100 hover:border-red-200"
                  onClick={() => handleListingClick(listing._id)}
                >
                  <div className="relative">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={listing.address}
                        className="w-full h-48 object-cover"
                      />
                    ) : (
                      <div className="w-full h-48 bg-gray-100 flex items-center justify-center text-gray-400">
                        No image
                      </div>
                    )}
                    {imageCount > 1 && (
                      <div className="absolute bottom-3 right-3 bg-black/70 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                        See all {imageCount} photos
                      </div>
                    )}
                  </div>
                  <div className="p-5 bg-gradient-to-br from-gray-50/50 to-white">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold text-2xl text-black">
                        {getRentRangeLabel(listing.unitTypes)}
                        <span className="text-sm font-normal">/month</span>
                      </h3>
                    </div>
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="flex items-center space-x-1 bg-gradient-to-r from-emerald-50 to-red-50 border border-emerald-200 px-3 py-1.5 rounded-full shadow-sm">
                        <span className="text-emerald-700 font-semibold text-sm">
                          {getUnitValuesLabel(listing.unitTypes, "bedrooms")}
                        </span>
                        <span className="text-emerald-600 text-xs">bd</span>
                      </div>
                      <div className="flex items-center space-x-1 bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-200 px-3 py-1.5 rounded-full shadow-sm">
                        <span className="text-rose-700 font-semibold text-sm">
                          {getUnitValuesLabel(listing.unitTypes, "bathrooms")}
                        </span>
                        <span className="text-rose-600 text-xs">ba</span>
                      </div>
                      <div className="flex items-center space-x-1 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 px-3 py-1.5 rounded-full shadow-sm">
                        <span className="text-amber-700 font-semibold text-sm">
                          {getAreaRangeLabel(listing.unitTypes)}
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
                  <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-red-600 transition-[width] duration-300 group-hover:w-full" />
                  <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full p-2 shadow-xl border border-white/50">
                    <HeartIcon
                      session={session}
                      listingId={listing._id}
                      initial={
                        Boolean(session?.user) &&
                        Boolean(
                          session?.user?.favorites?.some(
                            (f) =>
                              String((f && f._id) || f) === String(listing._id)
                          ) ||
                            session?.user?.favoritesIds?.includes(
                              String(listing._id)
                            )
                        )
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {isModalOpen && (
          <ModalListing isOpen={isModalOpen} onClose={handleCloseModal}>
            {isLoading ? (
              <div>Loading...</div>
            ) : modalData ? (
              <ListingModalInfo
                HeartIcon={HeartIcon}
                session={session}
                listing={modalData}
              />
            ) : (
              <div>Error loading listing</div>
            )}
          </ModalListing>
        )}
      </div>

      {/* Map Section */}
      <div
        className="md:w-1/2 w-full h-64 md:h-full relative"
        style={{ position: "sticky", top: 0, height: "100%", minHeight: 0 }}
      >
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
