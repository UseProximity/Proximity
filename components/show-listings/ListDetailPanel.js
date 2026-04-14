"use client";

import ListingModalInfo from "@/components/show-listings/ListingModalInfo";
import HeartIcon from "@/components/HeartIcon";

export default function ListDetailPanel({ listing, session, onBack }) {
  const isFavorite =
    Boolean(session?.user) &&
    Boolean(
      session?.user?.favorites?.some(
        (f) => String((f && f._id) || f) === String(listing._id)
      ) || session?.user?.favoritesIds?.includes(String(listing._id))
    );

  return (
    <div className="relative">
      {/* Sticky overlay — h-0 so it takes no space in document flow */}
      <div className="sticky top-0 z-50 h-0 overflow-visible pointer-events-none">
        {/* Back button — left */}
        <button
          onClick={onBack}
          aria-label="Back to listings"
          className="pointer-events-auto absolute top-3 left-3 flex items-center justify-center w-9 h-9 rounded-full bg-white border border-gray-200 text-gray-600 hover:text-gray-900 hover:shadow-lg transition-shadow duration-150"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {/* Heart button — right */}
        <div className="pointer-events-auto absolute top-3 right-3 flex items-center justify-center w-11 h-11 rounded-full bg-white border border-gray-200 shadow hover:shadow-lg transition-shadow duration-150">
          <HeartIcon
            session={session}
            listingId={listing._id}
            initial={isFavorite}
          />
        </div>
      </div>
      <ListingModalInfo
        listing={listing}
        session={session}
        excludeTabs={["map"]}
        compact={true}
      />
    </div>
  );
}
