"use client";

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

import MapPopupCard, {
  ListingCard,
  MobileMapPopup,
} from "@/components/listings/MapPopupCard";
import ListDetailPanel from "@/components/listings/ListDetailPanel";
import BackToTop from "@/components/ui/BackToTop";
import SuggestedStrip, {
  SuggestedHeading,
  WIDE_GRID_CLASS,
} from "@/components/listings/SuggestedStrip";
import FiltersPanel from "@/components/listings/FiltersPanel";
import ComparePanel from "@/components/listings/ComparePanel";

import { setListingSource } from "@/utils/analytics";

const MapView = dynamic(() => import("@/components/listings/MapView"), {
  ssr: false,
});

export default function AvailableListings({
  session,
  listings,
  suggestedListings = [],
  suggestedMode = "suggested",
  suggestedLabel = "Suggested for you",
  // Every listing, before the filters: the price histogram of the filter drawer.
  rentsFor,
  onFiltersSaved = () => {},
  // Desktop: the map is hidden and the listings fill the page as a wider grid.
  mapHidden = false,
  // Compare Listings: null when closed, else the [left, right] picks (or null).
  compare = null,
  setCompare = () => {},
  filters,
  setFilters,
  handleReset,
  onClearSearch,
  search,
  setSearch,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The wide, map-less layout (three columns). Compare keeps the two-column
  // grid in the left column whether or not the map is hidden.
  const wideLayout = mapHidden && !compare;
  const compareIds = (compare ?? []).filter(Boolean).map((l) => l._id);

  // Track viewport so only the visible map instance is "active"
  // Default to desktop during SSR to avoid hydration mismatch
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  useEffect(() => {
    // Keep in sync with CSS breakpoint used by the layout
    const media = window.matchMedia("(min-width: 768px)");
    const handleChange = () => setIsDesktop(media.matches);
    // Initialize immediately on mount
    handleChange();
    if (media.addEventListener) {
      media.addEventListener("change", handleChange);
    } else {
      media.addListener(handleChange);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", handleChange);
      } else {
        media.removeListener(handleChange);
      }
    };
  }, []);

  const rawLat = parseFloat(searchParams.get("lat"));
  const rawLng = parseFloat(searchParams.get("lng"));
  // Memoize so the map's zoom effect runs once per coordinate set, not on
  // every render.
  const searchLocation = useMemo(
    () =>
      !isNaN(rawLat) && !isNaN(rawLng) ? { lat: rawLat, lng: rawLng } : null,
    [rawLat, rawLng]
  );

  // After the map finishes flying to a searched address, strip lat/lng from the
  // URL so we land back on a normal /browse and the zoom can't re-trigger.
  // Read the live URL (not the closed-over searchParams, which can be stale by
  // the time the fly-in settles) so other params like view=map are preserved.
  const handleSearchLocationConsumed = () => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("lat") && !params.has("lng")) return;
    params.delete("lat");
    params.delete("lng");
    const qs = params.toString();
    router.replace(`/browse${qs ? `?${qs}` : ""}`);
  };

  /* ── Map overlay card state ── */
  const [selectedListing, setSelectedListing] = useState(null);

  // A panel deep-linked from matchmaking arrives with ?src=matchmaking. Remember
  // the attribution for this tab (so save/contact events carry it), then strip
  // the param so it doesn't linger in the URL. history.replaceState (not
  // router.replace) so this can't race the other URL-writing effects here.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const src = params.get("src");
    const srcPanelId = params.get("panel");
    if (!src) return;
    if (src === "matchmaking" && srcPanelId)
      setListingSource(srcPanelId, "matchmaking");
    params.delete("src");
    const qs = params.toString();
    window.history.replaceState(null, "", `/browse${qs ? `?${qs}` : ""}`);
  }, []);

  /* ── Left panel expanded listing ── */
  const panelId = searchParams.get("panel");
  const [expandedListing, setExpandedListing] = useState(null);
  const panelRef = useRef(null);
  // The first visible card, and how far below the column top it sat, when a
  // panel opened, so closing it (button or browser back) puts the reader back
  // there instead of at the top. A card, not a pixel offset: the grid is wider
  // while the column is still narrowing, so a pixel offset points elsewhere.
  const gridScroll = useRef(null);
  const topCard = () => {
    const col = panelRef.current;
    const colTop = col?.getBoundingClientRect().top;
    const card = [...(col?.querySelectorAll("[data-listing-id]") ?? [])].find(
      (c) => c.getBoundingClientRect().bottom > colTop
    );
    return (
      card && {
        id: card.dataset.listingId,
        offset: card.getBoundingClientRect().top - colTop,
      }
    );
  };
  // Hiding or showing the map re-flows the cards (three columns <-> two), so the
  // same scroll offset would show other cards. This render is the one that
  // flips the layout and the DOM is still the old one, so note the card at the
  // top of the view now and put it back below. Left alone when the column is at
  // the top, and when a panel is open, whose saved card must be kept.
  const shownMapHidden = useRef(wideLayout);
  if (shownMapHidden.current !== wideLayout) {
    shownMapHidden.current = wideLayout;
    if (!expandedListing)
      gridScroll.current = panelRef.current?.scrollTop ? topCard() : null;
  }
  // True from a close until the column's width transition ends: the card above
  // is held in place on every resize of the column meanwhile (see below).
  const anchoring = useRef(false);
  // Set by a map pin click. If it closes the panel, that close ends in the
  // smooth scroll to the pin's card (below), so the saved card is only restored,
  // not held.
  const pinClose = useRef(false);
  // True while a pin-click close waits for the width slide to end before
  // scrolling to the pin's card: scrolled any earlier, the target is worked out
  // against the wider grid and misses once the grid narrows.
  const scrollAtSlideEnd = useRef(false);
  // Ticks when the column's width transition ends, so MapView can carry out a
  // pending pin-click centring.
  const [slideEnd, setSlideEnd] = useState(0);
  /*
   * Hiding or showing the map re-lays the column out (three centred cards <->
   * two, the wide suggestions box <-> the strip) and resizes it, which would
   * snap in view. So it is a fade-through for the cards and a glide for the map:
   * BrowseContent marks <body> with data-map-switching, which fades the column
   * out, sends the map off to the right and lets the column take its new width
   * at once, then flips mapHidden; here, once the new layout is in place (still
   * invisible), the mark is removed: the cards fade back in and the map glides
   * back in from the right. Only opacity and transform animate, so they keep
   * running while the page is busy with the heavy re-render. The map is resumed
   * at its final size at that point. (BrowseContent removes the mark too, after
   * a timeout, in case two quick toggles leave mapHidden unchanged and this
   * never runs.)
   */
  useEffect(() => {
    // After a frame has been drawn with the new layout, so the fade starts from it.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.body.removeAttribute("data-map-switching")
      )
    );
    return () => cancelAnimationFrame(frame);
  }, [mapHidden]);
  // The filter question as it stood on the last run of the reset effect below.
  const lastQuery = useRef({ filters, search });
  /*
   * True between opening a panel and its /api/listing/[id] response. The feed
   * object the panel opens with has no leases and no review bodies, so the
   * panel shows a skeleton rather than painting fallbacks it has to rewrite.
   * Cleared on failure as well as success, so a failed fetch degrades to the
   * feed data instead of leaving the skeleton up forever.
   */
  const [detailLoading, setDetailLoading] = useState(false);
  /*
   * The listing the in-flight detail fetch is for. Both fetches below used to
   * write their result unconditionally, so a response that arrived after the
   * reader had closed the panel or opened a different one would reopen or
   * overwrite it, putting the rendered panel out of step with ?panel= in the
   * URL, which is the only thing that decides what is open. Every write is now
   * gated on the response still being the one currently wanted.
   */
  const detailRequestId = useRef(null);

  /*
   * Close the panel. Always go through this rather than calling
   * setExpandedListing(null) directly: dropping the in-flight request id is
   * what stops a detail response that is already on the wire from landing
   * afterwards and re-opening a panel the URL no longer claims is open.
   */
  const clearPanel = () => {
    detailRequestId.current = null;
    setDetailLoading(false);
    setExpandedListing(null);
  };

  /*
   * Fetch the full listing (unit leases for rent, review bodies, review ids for
   * voting) for the panel. Late responses are discarded (see detailRequestId).
   */
  const loadDetail = (id) => {
    detailRequestId.current = id;
    setDetailLoading(true);
    fetch(`/api/listing/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (detailRequestId.current !== id) return;
        if (data) setExpandedListing(data);
        setDetailLoading(false);
      })
      .catch(() => {
        if (detailRequestId.current !== id) return;
        setDetailLoading(false);
      });
  };

  // Sync local state from URL — handles direct links, back/forward, and page reload
  useEffect(() => {
    if (!panelId) {
      clearPanel();
      return;
    }
    // Already showing this listing — don't re-fetch
    if (expandedListing && String(expandedListing._id) === panelId) return;
    // Try listings array first for instant render, then always fetch full detail
    const match = listings.find((l) => String(l._id) === panelId);
    if (match) setExpandedListing(match);
    loadDetail(panelId);
  }, [panelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The expanded panel above is desktop-only (hidden md:block), so on a phone a
  // ?panel= deep link — from the Proxy chat cards, the landlord analytics table,
  // or "View on map" — used to land on /browse with nothing open. Hand the
  // listing to the global ?listing= modal instead, which is already styled for
  // small screens and renders the same ListingModalInfo. Reads the live URL
  // rather than the closed-over searchParams so it can't reinstate the ?src=
  // the attribution effect above just stripped.
  useEffect(() => {
    if (isDesktop || !panelId) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("panel");
    params.set("listing", panelId);
    router.replace(`/browse?${params.toString()}`);
  }, [panelId, isDesktop]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPanel = (listing) => {
    // Replacing an open panel (from a pin's card) keeps the grid position
    // saved when the first panel opened.
    if (!expandedListing) gridScroll.current = topCard();
    setExpandedListing(listing); // immediate UI with browse data
    const params = new URLSearchParams(searchParams.toString());
    params.set("panel", listing._id);
    /*
     * Which unit satisfied the active filters, so the panel opens on the one the
     * renter actually asked for instead of the smallest-first default. Carried in
     * the URL rather than in state because the panel is URL-driven: this way it
     * survives a reload, back/forward, and the desktop→mobile handoff to
     * ?listing= below. Absent when no filter is on — there is no "match" to
     * honour then, and clean URLs stay clean.
     */
    if (listing.matchedUnitId) params.set("unit", listing.matchedUnitId);
    else params.delete("unit");
    router.push(`/browse?${params.toString()}`);
    // Fetch full detail (unit_leases for rent, review bodies, IDs for voting)
    loadDetail(String(listing._id));
  };

  const closePanel = () => {
    clearPanel(); // immediate UI
    const params = new URLSearchParams(searchParams.toString());
    params.delete("panel");
    params.delete("unit");
    const qs = params.toString();
    router.push(`/browse${qs ? `?${qs}` : ""}`);
  };

  // Compare replaces an open detail panel, which would hide the grid it picks from,
  // and the selected listing, so no map card for it is left behind once it exits.
  useEffect(() => {
    if (!compare) return;
    setSelectedListing(null);
    if (expandedListing) closePanel();
  }, [!!compare]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compare is desktop only: leaving the desktop layout closes it and clears it.
  useEffect(() => {
    if (!isDesktop) setCompare(null);
  }, [isDesktop]); // eslint-disable-line react-hooks/exhaustive-deps

  // While compare is open a card click picks the listing instead of opening it.
  // One capture handler covers the grid and the suggested strip; the heart (a
  // button) keeps working, and nothing navigates or reports an opened listing.
  const handleComparePick = (e) => {
    const id = e.target.closest("[data-listing-id]")?.dataset.listingId;
    if (!id || e.target.closest("button")) return;
    e.stopPropagation();
    e.preventDefault();
    setCompare((prev) => {
      const [left, right] = prev;
      if (left && String(left._id) === id) return [null, right];
      if (right && String(right._id) === id) return [left, null];
      const listing = [...suggestedListings, ...listings].find((l) => String(l._id) === id);
      if (!listing || (left && right)) return prev;
      return left ? [left, listing] : [listing, right];
    });
  };

  /*
   * Scroll the panel to top when a listing is expanded (and back to where the
   * grid was when it closes), keyed on the listing's
   * id, not on the object. The detail fetch replaces the feed object with a
   * fresh one for the SAME listing, and watching the object meant that second
   * arrival yanked the reader back to the top a couple of seconds after they
   * started reading. A layout effect, so the position is set before the
   * browser paints and the grid never shows at the top first.
   */
  useLayoutEffect(() => {
    const col = panelRef.current;
    if (!col) return;
    col.scrollTop = 0;
    // With the map hidden the column does not change width, so there is no
    // slide to wait for.
    anchoring.current = !wideLayout && !expandedListing && !pinClose.current;
    scrollAtSlideEnd.current = !wideLayout && !expandedListing && pinClose.current;
    pinClose.current = false;
    if (!expandedListing) anchorGrid();
  }, [expandedListing?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll the saved card back to where it was. Relative to where it is now,
  // so it is right at any column width.
  const anchorGrid = () => {
    const col = panelRef.current;
    const { id, offset } = gridScroll.current ?? {};
    const card = id && col?.querySelector(`[data-listing-id="${id}"]`);
    if (card)
      col.scrollTop +=
        card.getBoundingClientRect().top - col.getBoundingClientRect().top - offset;
  };

  // The new layout is in place and still invisible (see the fade-through above).
  useLayoutEffect(() => {
    if (!expandedListing) anchorGrid();
  }, [wideLayout]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the column slides narrower the grid reflows and the saved card would
  // drift. A ResizeObserver runs after layout and before paint, so re-pinning
  // it here means no frame shows it anywhere else.
  useEffect(() => {
    const col = panelRef.current;
    if (!col) return;
    const observer = new ResizeObserver(() => {
      if (anchoring.current) anchorGrid();
    });
    observer.observe(col);
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll panel to the selected listing card when a pin is clicked (centered)
  const scrollToSelected = () => {
    const card = panelRef.current?.querySelector(
      `[data-listing-id="${selectedListing._id}"]`
    );
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  useEffect(() => {
    if (!selectedListing || expandedListing || !panelRef.current) return;
    if (!scrollAtSlideEnd.current) scrollToSelected();
  }, [selectedListing]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Viewport / "Browse this area" filter ── */
  const [viewportBounds, setViewportBounds] = useState(null);

  const handleBrowseArea = (bounds) => {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    setViewportBounds({
      swLat: sw.lat,
      swLng: sw.lng,
      neLat: ne.lat,
      neLng: ne.lng,
    });
  };

  /*
   * The suggested strip sits above the list on the unfiltered view only.
   * BrowseContent already empties it when a filter or search is on; "Browse
   * this area" is a filter too, so it hides here as well. While it shows, its
   * listings are taken out of the list below so no card appears twice.
   */
  const showSuggested = suggestedListings.length > 0 && !viewportBounds;
  const suggestedIdSet = useMemo(
    () => new Set(showSuggested ? suggestedListings.map((l) => String(l._id)) : []),
    [showSuggested, suggestedListings]
  );

  const visibleListings = useMemo(() => {
    const filtered = !viewportBounds
      ? listings
      : listings.filter(
          (l) =>
            l.latitude != null &&
            l.longitude != null &&
            l.latitude >= viewportBounds.swLat &&
            l.latitude <= viewportBounds.neLat &&
            l.longitude >= viewportBounds.swLng &&
            l.longitude <= viewportBounds.neLng
        );
    return [...filtered].sort((a, b) => {
      /*
       * Unavailable (greyed-out) listings last — that is the only demotion.
       * Everything above it keeps the order filterListings already ranked it
       * in, which includes pre-leased listings with a future availableFrom:
       * those are live inventory wearing an "Available Aug 1" badge, so they
       * sit in the mix with the ones open today rather than in a tier below.
       */
      return (a.unavailable ? 1 : 0) - (b.unavailable ? 1 : 0);
    }).filter((l) => !suggestedIdSet.has(String(l._id)));
  }, [listings, viewportBounds, suggestedIdSet]);

  // Headline count includes the pinned cards, which are still results.
  const resultCount = visibleListings.length + suggestedIdSet.size;

  /* ── Mobile UI state ── */
  const [mobileView, setMobileView] = useState(() => {
    if (typeof window === "undefined") return "listings";
    // Default to listings unless URL explicitly requests the map tab.
    return new URLSearchParams(window.location.search).get("view") === "map"
      ? "map"
      : "listings";
  });

  // Sync mobileView when URL changes (back/forward navigation)
  useEffect(() => {
    const v = searchParams.get("view");
    setMobileView(v === "map" ? "map" : "listings");
  }, [searchParams]);

  const switchMobileView = (view) => {
    setMobileView(view);
    if (view === "listings") setSelectedListing(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    router.push(`/browse?${params.toString()}`);
  };

  // On mobile, a ?lat=&lng= deep link should open the map tab so the zoom to
  // the searched address is visible.
  useEffect(() => {
    if (searchLocation && !isDesktop && mobileView !== "map") {
      switchMobileView("map");
    }
  }, [searchLocation, isDesktop]); // eslint-disable-line react-hooks/exhaustive-deps

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  /*
   * Clear the map overlay card and the expanded panel when the RENTER changes
   * what they are looking for.
   *
   * This used to watch the `listings` array instead, which is wrong on both
   * sides. /browse is server-seeded (initialListings), so AvailableListings
   * mounts with real data and then BrowseContent's freshness refetch of
   * /api/listings hands down a brand-new array about a second later, which it read as
   * "the filters changed", which closed any panel opened on that first second
   * and stripped ?panel= from the URL. That is what made "View on map" from the
   * homepage open the panel and immediately bounce out of it. The array
   * identity also changes when savedIds moves (hearting a listing re-runs
   * filterListings), which closed the panel out from under a save.
   *
   * The filter state and the search string ARE the question being asked, so
   * watch those directly, and only act when they actually move: so a direct
   * ?panel= deep link survives first render.
   */
  useEffect(() => {
    /*
     * Compare against the last values rather than flagging "first run": React
     * StrictMode double-invokes effects in development, and a first-run flag
     * lets the SECOND invocation through, which closed every deep-linked panel
     * the moment it opened. Comparing values is idempotent, so re-running the
     * effect without a real change is a no-op.
     */
    if (
      lastQuery.current.filters === filters &&
      lastQuery.current.search === search
    ) {
      return;
    }
    lastQuery.current = { filters, search };
    setSelectedListing(null);
    gridScroll.current = null; // a different result set starts at the top
    if (panelRef.current) panelRef.current.scrollTop = 0;
    clearPanel();
    if (panelId) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("panel");
      const qs = params.toString();
      router.replace(`/browse${qs ? `?${qs}` : ""}`);
    }
  }, [filters, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePinClose = () => {
    setSelectedListing(null);
    // The card of a pin picked while a panel is open: closing it leaves the
    // panel as it is.
    if (expandedListing) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lat");
    params.delete("lng");
    params.delete("panel");
    const qs = params.toString();
    router.replace("/browse" + (qs ? "?" + qs : ""));
  };

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
        <svg
          className="w-12 h-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
      </div>
      <h3 className="text-2xl font-bold text-gray-900 mb-3">
        No listings found
      </h3>
      <p className="text-gray-600 mb-6 max-w-md leading-relaxed">
        We couldn&apos;t find any listings matching your criteria. Try adjusting
        your filters or search terms.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleReset}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors duration-200 shadow-lg hover:shadow-xl"
        >
          Clear all filters
        </button>
        {onClearSearch && (
          <button
            onClick={onClearSearch}
            className="px-6 py-3 bg-white hover:bg-gray-50 text-red-600 border-2 border-red-600 hover:border-red-700 font-semibold rounded-xl transition-colors duration-200 shadow-lg hover:shadow-xl"
          >
            Clear search
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* ── Desktop listing panel ── */}
      <div
        ref={panelRef}
        className={`hidden md:block shrink-0 overflow-y-auto [overflow-anchor:none] scrollbar-hidden transition-[width] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-[1ms] [body[data-map-switching]_&]:transition-none ${
          wideLayout ? "w-full" : expandedListing ? "w-[58vw]" : "w-[40vw]"
        } ${expandedListing ? "" : "px-3 pt-3 pb-4"}`}
        style={{ height: "100%", minHeight: 0 }}
        onClickCapture={compare ? handleComparePick : undefined}
        onTransitionEnd={(e) => {
          // transitionend fires before the final frame's resize callback, so
          // pin the card once more here before letting go.
          if (e.target === e.currentTarget && e.propertyName === "width") {
            if (anchoring.current) anchorGrid();
            anchoring.current = false;
            if (scrollAtSlideEnd.current && selectedListing) {
              scrollAtSlideEnd.current = false;
              scrollToSelected();
            }
            setSlideEnd((n) => n + 1);
          }
        }}
      >
        {/*
         * No AnimatePresence here, deliberately. Swapping the grid and the
         * detail panel through it meant every swap waited on framer's exit
         * lifecycle, and that lifecycle does not complete in this container.
         * Under mode="wait" the incoming child was never let in at all on the
         * deep-link path (?panel= on first load, where an effect drives the
         * swap during mount): the column widened to the panel width while still showing
         * the listing grid, so the URL claimed a panel was open and none was.
         * Without mode="wait" the entry worked but the outgoing child was
         * never unmounted, leaving an invisible opacity-0 copy of the panel
         * behind on every swap, still mounted and still reachable by keyboard.
         * Only the ENTERING side is animated now, keyed so each listing fades
         * in on open, and there is no exit handshake left to hang on.
         */}
        <div className="will-change-[opacity] transition-opacity duration-[200ms] motion-reduce:duration-[1ms] [body[data-map-switching]_&]:opacity-0 [body[data-map-switching]_&]:duration-[120ms]">
        {/* Outside the grid wrapper below: its slide beside the filters panel is a
            transform, and a transformed element is the containing block of its
            fixed descendants, which would carry this button away with it. */}
        {!expandedListing && (
          <BackToTop
            scrollRef={panelRef}
            after={600}
            position={
              wideLayout
                ? "bottom-6 right-6 [body[data-filters-panel]_&]:right-[325px]"
                : "bottom-6 left-[calc(40vw-3.75rem)]"
            }
            tone="light"
          />
        )}
        {expandedListing ? (
          <motion.div
            key={`detail-${expandedListing._id}`}
            className={wideLayout ? "mx-auto w-[58vw]" : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          >
            <ListDetailPanel
              listing={expandedListing}
              detailLoading={detailLoading}
              initialUnitId={searchParams.get("unit")}
              onBack={() => {
                setSelectedListing(null);
                closePanel();
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="grid"
            // Three columns of the same card width as the two-column grid
            // ((40vw - 36px) / 2 each, 30px apart), centred.
            // With the map hidden the grid takes the page's width, capped so it
            // never passes four columns. While the side filters panel is open
            // (it sets data-filters-panel on <body>) the grid gives up the
            // panel's width and re-fits its columns beside it. Done in CSS, so
            // opening the panel does not re-render the cards.
            className={
              wideLayout
                ? "mx-auto w-full max-w-[1400px] [body[data-filters-panel]_&]:mx-0 [body[data-filters-panel]_&]:w-[calc(100%-313px)]"
                : undefined
            }
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          >
            <div
              className={`flex items-center gap-2 mb-3 px-1 ${
                showSuggested ? "justify-between" : ""
              }`}
            >
              {showSuggested && <SuggestedHeading label={suggestedLabel} />}
              <p className="text-xs font-semibold text-gray-500">
                {resultCount}{" "}
                {viewportBounds ? "listings in this area" : "Listings Found"}
              </p>
              {viewportBounds && (
                <button
                  onClick={() => setViewportBounds(null)}
                  className="text-xs text-red-600 hover:text-red-700 font-medium"
                >
                  Show all
                </button>
              )}
            </div>

            {showSuggested && (
              <SuggestedStrip
                listings={suggestedListings}
                session={session}
                layout="grid"
                wide={wideLayout}
                mode={suggestedMode}
                label={suggestedLabel}
                selectedId={selectedListing?._id}
                compareIds={compareIds}
                onCardClick={(listing) => {
                  setSelectedListing(listing);
                  openPanel(listing);
                }}
              />
            )}

            {visibleListings.length === 0 && !showSuggested ? (
              emptyState
            ) : (
              <div
                className={
                  wideLayout ? WIDE_GRID_CLASS : "grid grid-cols-2 gap-3"
                }
              >
                {visibleListings.map((listing) => (
                  <div key={listing._id} data-listing-id={listing._id}>
                    <ListingCard
                      listing={listing}
                      session={session}
                      isSelected={selectedListing?._id === listing._id}
                      inCompare={compareIds.includes(listing._id)}
                      onCardClick={() => {
                        setSelectedListing(listing);
                        openPanel(listing);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
        </div>
      </div>

      {/* ── Desktop map (kept mounted while hidden, so it comes back where it was; paused, it does no pin or camera work meanwhile) ── */}
      <div
        className={`${wideLayout ? "hidden" : "hidden md:flex"} flex-1 w-full relative will-change-[transform,opacity] transition-[transform,opacity] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-[1ms] [body[data-map-switching]_&]:translate-x-full [body[data-map-switching]_&]:opacity-0 [body[data-map-switching]_&]:duration-[160ms]`}
        style={{ position: "sticky", top: 0, height: "100%", minHeight: 0 }}
      >
        <MapView
          listings={listings}
          filters={filters}
          setFilters={setFilters}
          handleReset={handleReset}
          onListingSelect={(listing) => {
            setSelectedListing(listing);
            // With a panel open, the pin only brings up its card on the map.
            // The panel stays until that card is clicked, which replaces it.
            if (expandedListing) return;
            pinClose.current = true;
            scrollAtSlideEnd.current = false;
            closePanel();
          }}
          selectedListingId={selectedListing?._id || expandedListing?._id}
          searchLocation={searchLocation}
          onSearchLocationConsumed={handleSearchLocationConsumed}
          isActive={isDesktop}
          paused={mapHidden}
          onBrowseArea={handleBrowseArea}
          panelExpanded={!!expandedListing}
          panelSlideEnd={slideEnd}
          suggestedIds={suggestedIdSet}
        />
        {/* Darkens the map while the side filters panel is open (it sets
            data-filters-panel on the body, see TopFilterBar). It takes no
            clicks, so the map can still be moved and its pins picked. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[15] bg-black opacity-0 transition-opacity duration-200 [body[data-filters-panel]_&]:opacity-20"
        />
        {selectedListing && selectedListing._id !== expandedListing?._id && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-72 pointer-events-auto">
            <MapPopupCard
              listing={selectedListing}
              session={session}
              onClose={handlePinClose}
              onCardClick={() => {
                openPanel(selectedListing);
              }}
            />
          </div>
        )}
        {/* Compare Listings lies over the map (scrim), or alone when the map is hidden. */}
        {compare && (
          <div
            className={`absolute inset-0 z-30 p-4 ${mapHidden ? "bg-gray-50" : "bg-black/20"}`}
          >
            <ComparePanel
              slots={compare}
              onRemove={(i) =>
                setCompare((c) => c.map((l, j) => (j === i ? null : l)))
              }
              onClose={() => setCompare(null)}
            />
          </div>
        )}
      </div>

      {/* ── Mobile layout ── */}
      <div
        className="md:hidden flex flex-col w-full"
        style={{ height: "100%" }}
      >
        {/* Content area: map or listings */}
        <div className="flex-1 relative overflow-hidden min-h-0">
          {/* MAP VIEW */}
          {mobileView === "map" && (
            <>
              <MapView
                listings={listings}
                filters={filters}
                setFilters={setFilters}
                handleReset={handleReset}
                onListingSelect={(listing) => {
                  setSelectedListing(listing);
                }}
                selectedListingId={selectedListing?._id}
                searchLocation={searchLocation}
                onSearchLocationConsumed={handleSearchLocationConsumed}
                isActive={!isDesktop}
                onBrowseArea={handleBrowseArea}
                suggestedIds={suggestedIdSet}
              />

              {/* Minimal pin popup */}
              {selectedListing && (
                <div className="absolute bottom-4 left-4 right-4 z-10 pointer-events-auto">
                  <MobileMapPopup
                    listing={selectedListing}
                    onClose={handlePinClose}
                    onViewListing={() =>
                      router.push(`/listings/${selectedListing._id}?from=map`)
                    }
                  />
                </div>
              )}

              {/* Filter / saved buttons */}
              <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                <button
                  onClick={() => setMobileFiltersOpen(true)}
                  className="bg-white rounded-full p-3 shadow-lg border border-gray-200 active:bg-gray-50"
                  aria-label="Open filters"
                >
                  <img
                    src="/assets/filter-icon.svg"
                    alt=""
                    className="w-5 h-5"
                    style={{ filter: "brightness(0) opacity(0.7)" }}
                  />
                </button>
                <button
                  onClick={() =>
                    setFilters({ ...filters, savedOnly: !filters.savedOnly })
                  }
                  className={`rounded-full p-3 shadow-lg border active:opacity-80 transition-colors ${
                    filters.savedOnly
                      ? "bg-gray-200 border-gray-300"
                      : "bg-white border-gray-200"
                  }`}
                  aria-label={
                    filters.savedOnly
                      ? "Show all listings"
                      : "Show saved listings"
                  }
                >
                  <svg
                    className="w-5 h-5 text-gray-700"
                    fill={filters.savedOnly ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 016.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z"
                    />
                  </svg>
                </button>
              </div>
            </>
          )}

          {/* LISTINGS VIEW */}
          {mobileView === "listings" && (
            <div className="h-full overflow-y-auto scrollbar-hidden bg-gray-50">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                {showSuggested && <SuggestedHeading label={suggestedLabel} />}
                <span className="text-xs font-semibold text-gray-500">
                  {resultCount}{" "}
                  {viewportBounds ? "in this area" : "Listings Found"}
                </span>
                {viewportBounds && (
                  <button
                    onClick={() => setViewportBounds(null)}
                    className="text-xs text-red-600 font-medium"
                  >
                    Show all
                  </button>
                )}
              </div>
              <div className="px-4 pt-2 pb-3 flex items-center gap-2">
                {mobileSearchOpen ? (
                  <div className="flex-1 flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-2 shadow-sm transition focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-500/10">
                    <svg
                      className="h-4 w-4 text-red-500 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"
                      />
                    </svg>
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search for existing listings"
                      value={search || ""}
                      onChange={(e) => setSearch && setSearch(e.target.value)}
                      onBlur={() => {
                        const url = new URL(window.location);
                        if (search) {
                          url.searchParams.set("search", search);
                        } else {
                          url.searchParams.delete("search");
                        }
                        window.history.replaceState({}, "", url);
                      }}
                      className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-gray-900 outline-none placeholder:text-gray-400"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSearch && setSearch("");
                        const url = new URL(window.location);
                        url.searchParams.delete("search");
                        window.history.replaceState({}, "", url);
                        setMobileSearchOpen(false);
                      }}
                      className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 active:scale-95"
                      aria-label="Close search"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setMobileFiltersOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-medium text-gray-700 shadow-sm active:bg-gray-50"
                    >
                      <img
                        src="/assets/filter-icon.svg"
                        alt=""
                        className="w-3.5 h-3.5"
                        style={{ filter: "brightness(0) opacity(0.7)" }}
                      />
                      Filters
                    </button>
                    <button
                      onClick={() =>
                        setFilters({
                          ...filters,
                          savedOnly: !filters.savedOnly,
                        })
                      }
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-gray-700 border transition-colors active:opacity-80 shadow-sm ${
                        filters.savedOnly
                          ? "bg-gray-200 border-gray-300"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      <svg
                        className="w-3.5 h-3.5 text-gray-700"
                        fill={filters.savedOnly ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 016.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z"
                        />
                      </svg>
                      Saved
                    </button>
                    <button
                      onClick={() => setMobileSearchOpen(true)}
                      className="ml-auto flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white border border-gray-200 shadow-sm active:bg-gray-50"
                      aria-label="Search existing listings"
                    >
                      <svg
                        className="h-4 w-4 text-gray-600"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"
                        />
                      </svg>
                    </button>
                  </>
                )}
              </div>
              <div className="px-4 pb-6 space-y-4">
                {showSuggested && (
                  <SuggestedStrip
                    listings={suggestedListings}
                    session={session}
                    layout="stack"
                    mode={suggestedMode}
                    label={suggestedLabel}
                    onCardClick={(listing) =>
                      router.push(`/listings/${listing._id}?from=listings`)
                    }
                  />
                )}
                {visibleListings.length === 0 && !showSuggested
                  ? emptyState
                  : visibleListings.map((listing) => (
                      <ListingCard
                        key={listing._id}
                        listing={listing}
                        session={session}
                        onCardClick={() =>
                          router.push(`/listings/${listing._id}?from=listings`)
                        }
                      />
                    ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom toggle bar */}
        <div
          className="flex-shrink-0 bg-white border-t border-gray-200 flex"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <button
            onClick={() => switchMobileView("map")}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-semibold transition-colors ${
              mobileView === "map" ? "text-[#E8000B]" : "text-gray-400"
            }`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
            Map
          </button>
          <button
            onClick={() => switchMobileView("listings")}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-semibold transition-colors ${
              mobileView === "listings" ? "text-[#E8000B]" : "text-gray-400"
            }`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 10h16M4 14h16M4 18h16"
              />
            </svg>
            Listings
          </button>
        </div>

        {/* Filters drawer (slides up from bottom with backdrop) */}
        {mobileFiltersOpen && (
          <div className="fixed inset-0 z-50">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileFiltersOpen(false)}
            />
            {/* Panel */}
            <div
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl flex flex-col"
              style={{ maxHeight: "90vh" }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 bg-gray-300 rounded-full" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
                <h2 className="text-lg font-bold text-gray-900">Filters</h2>
                <button
                  onClick={() => setMobileFiltersOpen(false)}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Body and footer: the desktop side panel, in the drawer */}
              <FiltersPanel
                drawer
                rentsFor={rentsFor}
                filters={filters}
                onReset={handleReset}
                onApply={(next) => {
                  setFilters(next);
                  onFiltersSaved(next);
                  setMobileFiltersOpen(false);
                }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
