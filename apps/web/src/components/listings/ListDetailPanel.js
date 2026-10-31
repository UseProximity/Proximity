"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import ListingModalInfo, { scrollParent } from "@/components/listings/ListingModalInfo";
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
  const pills = usePills(detailLoading);

  return (
    <div ref={pills.ref} className="relative">
      {/*
        * White pills over the photos instead of a bar above them (Wyatt,
        * 2026-10-31). At the top they are part of the page and scroll off
        * with the photos. From anywhere further down, a scroll up slides a
        * copy down from the top and a scroll down slides it away again. Only
        * one set ever shows: once the copy has come in, the page's own pills
        * stay hidden until the panel is back at the very top. When the title
        * and tabs are stuck to the top the copy comes in just under them
        * (--listing-head is their height) so it never covers them.
        */}
      <div
        className={`sticky z-40 h-0 ${pills.stuck ? "top-[var(--listing-head)]" : "top-0"} ${
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
      <div className={`absolute inset-x-0 top-0 z-30 ${pills.original ? "" : "invisible"}`}>
        <Pills onBack={onBack} listingId={listing._id} />
      </div>
      <ListingModalInfo
        listing={listing}
        session={session}
        excludeTabs={["map"]}
        compact={true}
        initialUnitId={initialUnitId}
        detailLoading={detailLoading}
        onHeadStuck={pills.setStuck}
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
 * ready to slide in) while scrolling down. `original` is whether the page's
 * own pills may show: true until the copy first slides in, then false until
 * the top is reached again. The panel scrolls inside its
 * column, not the window, so this listens on the nearest scrolling ancestor.
 *
 * Whether the title and tabs are stuck comes from ListingModalInfo, which
 * already tracks it (setStuck is its onHeadStuck). Their height is watched
 * with a ResizeObserver, so it follows the header while it compacts instead
 * of being measured on every scroll.
 */
function usePills(detailLoading) {
  const ref = useRef(null);
  const [mode, setMode] = useState("off");
  const [stuck, setStuck] = useState(false);
  const [original, setOriginal] = useState(true);
  useEffect(() => {
    const head = ref.current?.querySelector("#listing-head");
    if (!head) return;
    const observer = new ResizeObserver(() =>
      ref.current?.style.setProperty("--listing-head", `${head.offsetHeight}px`)
    );
    observer.observe(head);
    return () => observer.disconnect();
  }, [detailLoading]);
  useEffect(() => {
    const el = scrollParent(ref.current);
    if (!el) return;
    let last = el.scrollTop;
    const onScroll = () => {
      const top = el.scrollTop;
      if (top <= 0) {
        setMode("off");
        setOriginal(true);
      } else if (top < last) {
        setMode("shown");
        setOriginal(false);
      } else if (top > last) setMode("hidden");
      last = top;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  return { ref, mode, stuck, setStuck, original };
}
