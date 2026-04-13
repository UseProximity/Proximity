"use client";

import ListingModalInfo from "@/components/show-listings/ListingModalInfo";

export default function ListDetailPanel({ listing, session, onBack }) {
  return (
    <div className="relative">
      {/* Sticky overlay back arrow — h-0 so it takes no space in document flow */}
      <div className="sticky top-0 z-50 h-0 overflow-visible pointer-events-none">
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
