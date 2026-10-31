"use client";

import { useEffect, useRef, useState } from "react";
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
  const pills = usePillsVisible();

  return (
    <div ref={pills.ref}>
      {/* White pills over the photos instead of a bar above them (Wyatt,
          2026-10-31). They ride along at the top of the panel: shown over the
          photos and whenever the student scrolls up, tucked away while they
          scroll down past the photos. Zero height, so nothing below moves.
          Past the photos the tabs are stuck to the top, so the pills come
          back just under them instead of over them (top-12 clears the tabs). */}
      <div className={`sticky z-40 h-0 ${pills.past ? "top-12" : "top-0"}`}>
        <div
          className={`pointer-events-none flex items-center justify-between p-3 transition duration-200 ${
            pills.visible
              ? "translate-y-0 opacity-100"
              : "-translate-y-full opacity-0 [&>*]:!pointer-events-none"
          }`}
        >
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

// Past this many pixels of scroll the photos are behind the student, and the
// pills only come back when they scroll up.
const PHOTOS_HEIGHT = 300;

/*
 * Shown at the top and on any scroll up; hidden on a scroll down once past the
 * photos. The panel scrolls inside its column, not the window, so this listens
 * on the nearest scrolling ancestor.
 */
function usePillsVisible() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(true);
  const [past, setPast] = useState(false);
  useEffect(() => {
    let el = ref.current?.parentElement;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    if (!el) return;
    let last = el.scrollTop;
    const onScroll = () => {
      const top = el.scrollTop;
      setPast(top >= PHOTOS_HEIGHT);
      if (top < PHOTOS_HEIGHT || top < last) setVisible(true);
      else if (top > last) setVisible(false);
      last = top;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  return { ref, visible, past };
}
