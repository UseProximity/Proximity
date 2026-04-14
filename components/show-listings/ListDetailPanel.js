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
    <div>
      {/* Sticky top banner */}
      <div className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          aria-label="Back to listings"
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors duration-150"
        >
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-sm font-semibold">Back to listings</span>
        </button>
        <div className="flex items-center gap-2 text-gray-600">
          <span className="text-sm font-semibold">Save this listing</span>
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
