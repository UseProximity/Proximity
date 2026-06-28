"use client";

import { useEffect, useState } from "react";
import { ListingCard } from "@/components/listings/MapPopupCard";

const INTENTION_COLORS = {
  "Best overall match": "bg-red-100 text-red-700",
  "Closest to campus": "bg-blue-100 text-blue-700",
  "Best value": "bg-green-100 text-green-700",
  "Best reviews": "bg-yellow-100 text-yellow-700",
  "Most amenities": "bg-purple-100 text-purple-700",
  "Most flexible lease": "bg-orange-100 text-orange-700",
  "Best social fit": "bg-pink-100 text-pink-700",
};

// Open the browse page in a new tab with this listing's detail panel open.
function openListing(listingId) {
  window.open(`/browse?panel=${listingId}`, "_blank", "noopener,noreferrer");
}

export default function RecommendationCards({ recommendations }) {
  const [listingsById, setListingsById] = useState({});

  // Fetch the real browse-shaped listing objects so we can render the exact
  // same card component used on the browse page.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!recommendations?.length) return;
      const entries = await Promise.all(
        recommendations.map(async (rec) => {
          try {
            const res = await fetch(`/api/listing/${rec.listing_id}`);
            if (!res.ok) return null;
            const listing = await res.json();
            return [rec.listing_id, listing];
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      setListingsById(Object.fromEntries(entries.filter(Boolean)));
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [recommendations]);

  if (!recommendations?.length) return null;

  return (
    <div className="space-y-3">
      {recommendations.map((rec) => {
        const listing = listingsById[rec.listing_id];
        const intentionClass = INTENTION_COLORS[rec.intention] ?? "bg-gray-100 text-gray-700";
        return (
          <div key={rec.listing_id} className="space-y-1.5 w-2/3 min-w-[12rem]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${intentionClass}`}>
                {rec.intention}
              </span>
            </div>
            {rec.reason && (
              <p className="text-[11px] text-gray-500 italic leading-snug line-clamp-2">{rec.reason}</p>
            )}
            {listing ? (
              <ListingCard listing={listing} onCardClick={openListing} />
            ) : (
              <div className="aspect-video rounded-2xl bg-gray-100 animate-pulse" />
            )}
          </div>
        );
      })}
    </div>
  );
}
