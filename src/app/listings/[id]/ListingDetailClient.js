"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ListingModalInfo from "@/components/listings/ListingModalInfo";
import HeartIcon from "@/components/ui/HeartIcon";

export default function ListingDetailClient({ listingId, session }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const from = searchParams.get("from");

  useEffect(() => {
    fetch(`/api/listing/${listingId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setListing(data);
        else setNotFound(true);
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [listingId]);

  const handleBack = () => {
    if (from === "map") router.push("/browse?view=map");
    else if (from === "listings") router.push("/browse?view=listings");
    else router.back();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600" />
      </div>
    );
  }

  if (notFound || !listing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
        <p className="text-4xl">🏠</p>
        <p className="text-lg font-semibold text-gray-800">Listing not found</p>
        <p className="text-sm text-gray-500">
          This listing may have been removed or the link is invalid.
        </p>
        <button
          onClick={handleBack}
          className="mt-2 px-5 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Sticky header with back button */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 shadow-sm flex items-center gap-3 px-4 py-3">
        <button
          onClick={handleBack}
          className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors flex-shrink-0"
          aria-label="Go back"
        >
          <svg
            className="w-5 h-5 text-gray-700"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <span className="flex-1 font-semibold text-gray-900 text-sm truncate">
          {listing.title || listing.address?.split(",")[0]}
        </span>
        <div className="bg-white/90 backdrop-blur-md rounded-full p-1.5 shadow border border-gray-100 flex-shrink-0">
          <HeartIcon listingId={listing._id} />
        </div>
      </div>

      {/* Detail content */}
      <div className="flex-1">
        <ListingModalInfo session={session} listing={listing} />
      </div>
    </div>
  );
}
