"use client";

import { useEffect, useRef } from "react";
import { ListingCard } from "@/components/listings/MapPopupCard";
import { trackEvent, setListingSource } from "@/utils/analytics";

/*
 * Pinned "Suggested for you" strip at the top of the /browse list. Renders
 * nothing when there are no suggestions, so a student without enough signal
 * never sees an empty "suggested" heading. The heading swatch ties the cards
 * to their highlighted map pins (SUGGESTED_PIN_COLOR in MapView; keep the two
 * in step).
 *
 * layout="grid" is the desktop two-column panel, "stack" the mobile list.
 *
 * Analytics: suggested_impression / suggested_click here; saves and contacts
 * that follow a click carry source=suggested on their existing events.
 */
export default function SuggestedStrip({
  listings,
  session,
  layout = "grid",
  selectedId = null,
  onCardClick,
}) {
  // One impression per distinct set shown, not per re-render.
  const lastImpression = useRef("");
  const key = listings.map((l) => l._id).join(",");
  useEffect(() => {
    if (!key || lastImpression.current === key) return;
    lastImpression.current = key;
    trackEvent("suggested_impression", {
      surface: "browse",
      layout,
      count: listings.length,
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!listings.length) return null;

  return (
    <section aria-label="Suggested for you" className="mb-6">
      <div className="flex items-center gap-2 px-1 mb-3">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 rounded-full bg-[#A1000A]"
        />
        <h2 className="text-sm font-bold text-gray-900">Suggested for you</h2>
      </div>
      <div
        className={
          layout === "grid" ? "grid grid-cols-2 gap-6" : "space-y-4"
        }
      >
        {listings.map((listing, i) => (
          <div
            key={listing._id}
            // Desktop only: AvailableListings scrolls to this when its pin is
            // clicked. The hidden mobile copy must not compete for the match.
            data-listing-id={layout === "grid" ? listing._id : undefined}
          >
            <ListingCard
              listing={listing}
              session={session}
              isSelected={selectedId === listing._id}
              onCardClick={() => {
                trackEvent("suggested_click", {
                  surface: "browse",
                  listing_id: String(listing._id),
                  position: i + 1,
                });
                // Lets the existing save/contact events report source=suggested.
                setListingSource(listing._id, "suggested");
                onCardClick(listing);
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-6 border-t border-gray-200" />
    </section>
  );
}
