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
  const pills = usePills();

  return (
    <div ref={pills.ref} className="relative">
      {/*
        * White pills over the photos instead of a bar above them (Wyatt,
        * 2026-10-31). At the top they are part of the page and scroll off
        * with the photos. From anywhere further down, a scroll up slides a
        * copy down from the top and a scroll down slides it away again. When
        * the tabs are stuck to the top the copy comes in just under them
        * (top-12 clears the tabs) so it never covers them.
        */}
      <div
        className={`sticky z-40 h-0 ${pills.stuck ? "top-12" : "top-0"} ${
          pills.mode === "off" ? "hidden" : ""
        }`}
      >
        <div
          className={`transition duration-200 ${
            pills.mode === "shown"
              ? "translate-y-0 opacity-100"
              : "-translate-y-full opacity-0 [&_*]:!pointer-events-none"
          }`}
        >
          <Pills onBack={onBack} listingId={listing._id} />
        </div>
      </div>
      <div className="absolute inset-x-0 top-0 z-30">
        <Pills onBack={onBack} listingId={listing._id} />
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

function Pills({ onBack, listingId }) {
  return (
    <div className="pointer-events-none flex items-center justify-between p-3">
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
        <HeartIcon listingId={listingId} />
      </div>
    </div>
  );
}

/*
 * The sliding copy's state: "off" at the very top, where the page's own pills
 * are in place; "shown" while scrolling up; "hidden" (parked above the top,
 * ready to slide in) while scrolling down. The panel scrolls inside its
 * column, not the window, so this listens on the nearest scrolling ancestor.
 */
function usePills() {
  const ref = useRef(null);
  const [mode, setMode] = useState("off");
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    let el = ref.current?.parentElement;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    if (!el) return;
    let last = el.scrollTop;
    const onScroll = () => {
      const top = el.scrollTop;
      const tabs = el.querySelector("#listing-tabs");
      setStuck(!!tabs && tabs.getBoundingClientRect().top - el.getBoundingClientRect().top <= 1);
      if (top <= 0) setMode("off");
      else if (top < last) setMode("shown");
      else if (top > last) setMode("hidden");
      last = top;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  return { ref, mode, stuck };
}
