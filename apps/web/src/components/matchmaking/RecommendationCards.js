"use client";

import { useEffect, useState } from "react";
import { ListingCard } from "@/components/listings/MapPopupCard";
import { trackEvent, setListingSource } from "@/utils/analytics";

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
// `src=matchmaking` lets the browse tab attribute the open (and any save/contact
// that follows) back to the matchmaking flow.
function openListing(listingId, intention, position) {
  trackEvent("Proxy Listing Clicked", { listingId, intention, position });
  // Mark this tab too — the card's own "Listing Opened" event reads it back.
  setListingSource(listingId, "matchmaking");
  window.open(`/browse?panel=${listingId}&src=matchmaking`, "_blank", "noopener,noreferrer");
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
    // Desktop: three picks side by side for at-a-glance comparison. Mobile: stack them
    // in a single column so each card is full width and all its info stays readable.
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {recommendations.map((rec, i) => {
        const listing = listingsById[rec.listing_id];
        const intentionClass = INTENTION_COLORS[rec.intention] ?? "bg-gray-100 text-gray-700";
        return (
          <div key={rec.listing_id} className="space-y-1.5 min-w-0">
            {/* Main idea on top, then the card, then the supporting reason underneath */}
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${intentionClass}`}>
                {rec.intention}
              </span>
            </div>
            {listing ? (
              <ListingCard listing={listing} onCardClick={(id) => openListing(id, rec.intention, i + 1)} compact />
            ) : (
              <div className="aspect-video rounded-2xl bg-gray-100 animate-pulse" />
            )}
            {rec.reason && (
              // One line, cut off with an ellipsis; hover shows the full reason as a tooltip.
              <p title={rec.reason} className="text-[11px] text-gray-500 italic leading-snug truncate">
                {rec.reason}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
