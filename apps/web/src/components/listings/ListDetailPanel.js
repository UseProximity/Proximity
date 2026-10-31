"use client";

import { useSession } from "next-auth/react";
import ListingModalInfo from "@/components/listings/ListingModalInfo";
import HeartIcon from "@/components/ui/HeartIcon";

export default function ListDetailPanel({
  listing,
  onBack,
  initialUnitId = null,
  // True while /api/listing/[id] is still in flight. The panel opens on browse
  // feed data, which has no leases and no review bodies. See ListingModalInfo.
  detailLoading = false,
}) {
  const { data: session } = useSession();

  return (
    <div className="relative">
      {/* White pills over the photos instead of a bar above them (Wyatt,
          2026-10-31). They scroll away with the photos; the tabs stick. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between p-3">
        <button
          onClick={onBack}
          aria-label="Back to listings"
          className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-gray-700 shadow-md transition-colors duration-150 hover:bg-white hover:text-gray-900"
        >
          <svg
            className="w-3.5 h-3.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-xs font-semibold">Back to listings</span>
        </button>
        <div className="pointer-events-auto flex items-center rounded-full bg-white/95 p-1 text-gray-700 shadow-md">
          <HeartIcon listingId={listing._id} />
        </div>
      </div>
      <ListingModalInfo
        listing={listing}
        session={session}
        excludeTabs={["map"]}
        compact={true}
        initialUnitId={initialUnitId}
        detailLoading={detailLoading}
      />
    </div>
  );
}
