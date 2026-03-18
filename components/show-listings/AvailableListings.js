"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

import ModalListing from "@/components/show-listings/ModalListing";
import ListingModalInfo from "@/components/show-listings/ListingModalInfo";
import { signIn } from "next-auth/react";
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
    // Optimistically setting favorite to: true/false
    setIsFavorite(next);
    setPending(true);

    try {
      if (!session?.user?.id) {
        // User ID not available, rolling back favorite state
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
  filters,
  setFilters,
  handleReset,
  onClearSearch,
}) {

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

  return (
    <>
      {/* Listings Section */}
      <div
        className="w-full md:w-[40vw] md:shrink-0 overflow-y-auto px-4 py-4"
        style={{ height: "100%", minHeight: 0 }}
      >
        <p className="text-sm font-semibold text-gray-500 px-1 mb-4">
          {listings.length} Listings Found
        </p>

        {listings.length === 0 ? (
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
            {listings.map((listing) => {
              const imageUrl = listing.images?.[0];
              const imageCount = listing.images?.length || 0;
              const [streetAddress, ...restParts] = listing.address.split(",");
              const cityStateZip = restParts.join(",").trim();
              const bedValues = listing.unitTypes.map((u) => u.bedrooms).filter(Number.isFinite);
              const bathValues = listing.unitTypes.map((u) => u.bathrooms).filter(Number.isFinite);
              const bedLabel = bedValues.length === 0 ? "N/A" : Math.min(...bedValues) === Math.max(...bedValues) ? String(Math.min(...bedValues)) : `${Math.min(...bedValues)}-${Math.max(...bedValues)}`;
              const bathLabel = bathValues.length === 0 ? "N/A" : Math.min(...bathValues) === Math.max(...bathValues) ? String(Math.min(...bathValues)) : `${Math.min(...bathValues)}-${Math.max(...bathValues)}`;

              return (
                <div
                  key={listing._id}
                  className="relative group bg-white rounded-2xl shadow-lg transition-colors duration-200 overflow-hidden border border-gray-100 hover:border-red-200 flex flex-col"
                  onClick={() => handleListingClick(listing._id)}
                >
                  <div className="relative">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={listing.address}
                        className="w-full aspect-video object-cover"
                      />
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
                        <h3 className="font-bold text-sm text-gray-900 leading-snug">
                          {streetAddress}
                        </h3>
                        {cityStateZip && (
                          <p className="text-xs text-gray-500 font-normal mt-0.5">
                            {cityStateZip}
                          </p>
                        )}
                      </div>
                      <span className="text-red-500 font-bold text-sm whitespace-nowrap flex-shrink-0">
                        {getRentRangeLabel(listing.unitTypes)}
                        <span className="text-xs font-normal">/mo</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-auto pt-2">
                      <span className="text-gray-500 text-xs">
                        {bedLabel} bed
                        {" | "}
                        {bathLabel} bath
                        {listing.leaseType ? ` | ${listing.leaseType}` : ""}
                      </span>
                      {listing.owner?.name && (
                        <span className="text-gray-400 text-xs truncate ml-2">
                          {listing.owner.name}
                        </span>
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
        className="flex-1 w-full h-64 md:h-full relative"
        style={{ position: "sticky", top: 0, height: "100%", minHeight: 0 }}
      >
        <MapView
          listings={listings}
          filters={filters}
          setFilters={setFilters}
          handleReset={handleReset}
        />
      </div>
    </>
  );
}
