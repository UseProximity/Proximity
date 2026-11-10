"use client";

import { useEffect, useRef, useState } from "react";
import { ListingCard } from "@/components/listings/MapPopupCard";
import { trackEvent, setListingSource } from "@/utils/analytics";

/*
 * Pinned "Suggested for you" strip at the top of the /browse list. Renders
 * nothing when there are no suggestions, so a student without enough signal
 * never sees an empty "suggested" heading. The heading swatch ties the cards
 * to their highlighted map pins (SUGGESTED_PIN_COLOR in MapView; keep the two
 * in step).
 *
 * layout="grid" is the desktop panel (two columns of cards, or with wide, for
 * the map-hidden page, one scrolling row in a box), "stack" the mobile list.
 *
 * Analytics: suggested_impression / suggested_click here; saves and contacts
 * that follow a click carry source=suggested on their existing events.
 */
/*
 * The strip's heading. AvailableListings renders it in the results row, on the
 * left where the listing count normally sits, and moves the count to the right.
 * With the map hidden (wide) the strip draws it inside its own box instead.
 */
export function SuggestedHeading({ label = "Suggested for you" }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full bg-[#A1000A]"
      />
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
  // Ids of the listings picked in Compare Listings, ringed like the grid's.
  compareIds = [],
  onCardClick,
  // The map is hidden and the page shows three columns. The suggestions sit in
  // a light box one row tall: exactly three whole cards, in the main grid's
  // columns and at its card width, and the rest a card at a time, by the round
  // buttons, the wheel, the trackpad or the arrow keys.
  wide = false,
}) {
  const rowRef = useRef(null);
  const [canScroll, setCanScroll] = useState({ prev: false, next: false });
  const key = listings.map((l) => l._id).join(",");

  // One card (and the gap after it) further, smoothly; the row snaps to whole
  // cards (see its classes), so it always ends on three whole cards.
  const step = (dir) => {
    const row = rowRef.current;
    row.scrollBy({
      left: dir * (row.children[1].offsetLeft - row.children[0].offsetLeft),
      behavior: "smooth",
    });
  };

  useEffect(() => {
    const row = rowRef.current;
    if (!wide || !row) return;
    // Keeps the old object when nothing changed, so scrolling does not re-render.
    const update = () => {
      const prev = row.scrollLeft > 1;
      const next = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      setCanScroll((c) => (c.prev === prev && c.next === next ? c : { prev, next }));
    };
    // A plain mouse wheel moves the row a card per turn while it can, then hands
    // the wheel back to the page. (Not a React onWheel: that one cannot
    // preventDefault.)
    let busy = false;
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const dir = Math.sign(e.deltaY);
      if (dir < 0 ? row.scrollLeft <= 1 : !canScrollNext()) return;
      e.preventDefault();
      if (busy) return;
      busy = true;
      setTimeout(() => (busy = false), 400);
      step(dir);
    };
    const canScrollNext = () =>
      row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    update();
    row.addEventListener("scroll", update, { passive: true });
    row.addEventListener("wheel", onWheel, { passive: false });
    const resize = new ResizeObserver(update);
    resize.observe(row);
    return () => {
      row.removeEventListener("scroll", update);
      row.removeEventListener("wheel", onWheel);
      resize.disconnect();
    };
  }, [wide, key]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <section
      aria-label={label}
      className={
        wide
          ? // 12px wider than the grid on each side (11px padding + 1px border), so
            // the cards' viewport is exactly the grid's width. A size container,
            // so the cards can take the grid's card width ((viewport - 60px) / 3)
            // in cqw units.
            "-ml-3 mb-5 w-[calc(100%+24px)] rounded-3xl border border-red-100 bg-[#fff5f5] px-[11px] py-6 [container-type:inline-size]"
          : "mb-6"
      }
    >
      {wide && (
        <div className="mb-4 flex items-center justify-between">
          <SuggestedHeading label={label} />
          {/* The row holds three whole cards, so it scrolls when there are more.
              Known from the count, so the buttons are there from the first
              render: appearing later, they grow this row and push the cards
              below it down (and off the card the reader was on). */}
          {listings.length > 3 && (
            <div className="flex gap-2">
              {[
                ["Previous suggestions", -1, canScroll.prev, "M15 19l-7-7 7-7"],
                ["Next suggestions", 1, canScroll.next, "M9 5l7 7-7 7"],
              ].map(([name, dir, enabled, path]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={name}
                  disabled={!enabled}
                  onClick={() => step(dir)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-red-100 bg-white text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={path} />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div
        ref={rowRef}
        // Focusable so the arrow keys scroll it, and snapping to whole cards.
        // The padding leaves room for the cards' shadows, which a scroller would
        // clip; it is the box's own padding, so the cards still start at the
        // grid's left edge.
        tabIndex={wide ? 0 : undefined}
        className={
          layout === "grid"
            ? wide
              ? "scrollbar-hidden -mx-[11px] -my-3 flex snap-x snap-mandatory scroll-pl-[11px] gap-[30px] overflow-x-auto rounded-xl px-[11px] py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 [&>:first-child]:ml-auto [&>:last-child]:mr-auto"
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
            className={wide ? "w-[calc((100cqw-60px)/3)] shrink-0 snap-start" : undefined}
          >
            <ListingCard
              listing={listing}
              session={session}
              isSelected={selectedId === listing._id}
              inCompare={compareIds.includes(listing._id)}
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
      {!wide && <div className="mt-6 border-t border-gray-200" />}
    </section>
  );
}
