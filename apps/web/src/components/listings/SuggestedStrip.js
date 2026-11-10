"use client";

import { useEffect, useRef } from "react";
import { ListingCard } from "@/components/listings/MapPopupCard";
import { trackEvent, setListingSource } from "@/utils/analytics";

/*
 * Pinned "Suggested for you" strip at the top of the /browse list. Renders
 * nothing when there are no suggestions, so a student without enough signal
 * never sees an empty "suggested" heading. The heading badge ties the cards
 * to their badged map pins (SUGGESTED_BADGE in MapView; keep the two in step).
 *
 * layout="grid" is the desktop panel (two columns of cards, or with wide, for
 * the map-hidden page, the same width-fitting grid as the listings under it),
 * "stack" the mobile list.
 *
 * Analytics: suggested_impression / suggested_click here; saves and contacts
 * that follow a click carry source=suggested on their existing events.
 */
/*
 * The strip's heading. AvailableListings renders it in the results row, on the
 * left where the listing count normally sits, and moves the count to the right.
 */
// Card grid of the map-hidden page, shared with AvailableListings so the
// suggestions and the listings under them line up: as many columns as fit, at
// least 300px each. The page caps its width so that is four at most.
export const WIDE_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-6 gap-y-4";

export function SuggestedHeading({ label = "Suggested for you" }) {
  return (
    <div className="flex items-center gap-2">
      <svg
        aria-hidden="true"
        viewBox="20.5 -0.5 10 10"
        className="h-3.5 w-3.5 shrink-0"
      >
        <circle cx="25.5" cy="4.5" r="5" fill="#F5B301" />
        <path
          d="M25.5 1.8l0.77 1.93 1.93 0.77-1.93 0.77-0.77 1.93-0.77-1.93-1.93-0.77 1.93-0.77z"
          fill="white"
        />
      </svg>
      <h2 className="text-xs font-bold text-gray-900">{label}</h2>
    </div>
  );
}

export default function SuggestedStrip({
  listings,
  session,
  layout = "grid",
  // "similar" when opened from the chat's no-reply note (?similar=<id>).
  mode = "suggested",
  label = "Suggested for you",
  selectedId = null,
  onCardClick,
  // The map is hidden: the cards use the page's width-fitting grid, wrapping
  // onto as many rows as they need (never a scrolling row).
  wide = false,
}) {
  const key = listings.map((l) => l._id).join(",");

  // One impression per distinct set shown, not per re-render.
  const lastImpression = useRef("");
  useEffect(() => {
    if (!key || lastImpression.current === key) return;
    lastImpression.current = key;
    trackEvent("suggested_impression", {
      surface: "browse",
      layout,
      mode,
      count: listings.length,
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!listings.length) return null;

  return (
    <section aria-label={label} className="mb-6">
      <div
        className={
          layout === "grid"
            ? wide
              ? WIDE_GRID_CLASS
              : "grid grid-cols-2 gap-3"
            : "space-y-4"
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
                  mode,
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
