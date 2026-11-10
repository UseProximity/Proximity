/*
 * Interactive Mapbox GL map for the browse page. Renders a pin for every listing within
 * the WashU area bounds, color-coded by price tier using custom SVG map icons. Clicking a
 * pin opens a popup with the listing's address, rent range, and a "View Details" link that
 * sets ?listing= in the URL to trigger GlobalListingModal. The selected listing's pin
 * swaps to an active-state icon and the map pans to it. Exposes onListingSelect to the
 * parent (AvailableListings) so the left-panel list stays in sync with the map selection.
 * Centered on WashU's Danforth Campus by default. Uses listingFormatters utilities for
 * consistent rent and unit label display across map popups and list cards.
 */
"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useRouter } from "next/navigation";
import { SHUTTLE_STOPS } from "@/utils/washuPlaces";
import MapErrorBoundary from "@/components/listings/MapErrorBoundary";

// Pin colors (Browse Listings Figma).
const AVAILABLE_PIN_COLOR = "#F71C1E";
const UNAVAILABLE_PIN_COLOR = "#A3A3A3";
const UNAVAILABLE_STAR_COLOR = "#E6E7EB";

// Pin and star shapes from the Figma design: a flat 30 by 42 pin with a soft
// drop shadow (lighter than the Figma's), the same size at every zoom. The star's top and bottom are
// used to fill it from the bottom up by rating.
const PIN_PATH =
  "M30 15.191C30 29 15 42 15 42C15 42 0 29.936 0 15.191C0 6.801 6.716 0 15 0C23.284 0 30 6.801 30 15.191Z";
const STAR_PATH =
  "M6.398 13.684C6.009 13.73 5.853 14.21 6.14 14.475L10.209 18.238C10.326 18.347 10.378 18.508 10.347 18.664L9.267 24.1C9.191 24.483 9.6 24.78 9.941 24.589L14.778 21.882C14.917 21.804 15.086 21.804 15.225 21.882L20.06 24.589C20.402 24.78 20.81 24.483 20.734 24.1L19.654 18.664C19.623 18.508 19.675 18.347 19.792 18.238L23.86 14.476C24.148 14.21 23.992 13.73 23.604 13.684L18.1 13.031C17.942 13.012 17.805 12.913 17.738 12.768L15.417 7.736C15.253 7.381 14.748 7.381 14.585 7.736L12.263 12.768C12.197 12.913 12.059 13.012 11.901 13.031L6.398 13.684Z";
const STAR_TOP = 7.47;
const STAR_BOTTOM = 24.65;
// "Suggested for you" pins are the normal pin with a gold sparkle badge on the
// top right corner. SuggestedStrip's heading shows the same badge; change both
// together.
const SUGGESTED_BADGE =
  '<circle cx="25.5" cy="4.5" r="5" fill="#F5B301"/><path d="M25.5 1.8l0.77 1.93 1.93 0.77-1.93 0.77-0.77 1.93-0.77-1.93-1.93-0.77 1.93-0.77z" fill="white"/>';
// The pin you clicked keeps the flat design and is drawn larger.
const SELECTED_PIN_SCALE = 1.3;
// A pin under the pointer grows by this much, and eases back when it leaves.
const HOVER_PIN_GROWTH = 1.1;

// A pin is three nested boxes. Mapbox owns the marker element's own transform
// (it writes the lng/lat translate there each frame), so the merge and split
// motion runs on the first wrapper and the selected size and the shadow sit on
// the second. Both scale from the bottom center, which keeps the pin's tip on
// its coordinate.
function pinMarkup(color, inner, scale = 1) {
  return `<div style="width:30px;height:42px;transform-origin:bottom center"><div style="width:30px;height:42px;transform-origin:bottom center;transform:scale(${scale});transition:transform 150ms ease-out;filter:drop-shadow(1px 2px 2px rgba(0,0,0,0.18))"><svg width="30" height="42" viewBox="0 0 30 42" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">
    <path d="${PIN_PATH}" fill="${color}"/>
    ${inner}
  </svg></div></div>`;
}

// Listings whose pins would sit closer than this on screen merge into one
// numbered pin. One pin width. Clustering stops at CLUSTER_MAX_ZOOM so
// listings at the same spot can always be told apart by zooming in; a cluster
// click zooms in by CLUSTER_ZOOM_STEP levels.
const CLUSTER_RADIUS_PX = 30;
const CLUSTER_MAX_ZOOM = 17;
const CLUSTER_ZOOM_STEP = 2;

// How long a pin takes to slide into or out of a group, or to appear.
const PIN_MOTION = { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" };
// Stacking order: a pin further south gets a higher z-index, at about a metre
// of latitude per step. The selected pin sits above them all.
const pinZIndex = (lat) => Math.round((90 - lat) * 100000);
const TOP_PIN_Z_INDEX = 20000000;

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// WashU Campus center coordinates (Danforth Campus)
const WASHU_CAMPUS_CENTER = {
  longitude: -90.3053,
  latitude: 38.6489,
};

// Initial fit covers the bulk of the listings rather than their full extent:
// a handful of far-flung ones would otherwise pull the camera way back and
// leave the dense area around campus unreadably small.
const FIT_PERCENTILE = 0.6;
const FIT_MIN_DELTA_DEG = 0.008; // ~0.5 mi, so a sparse result set can't over-zoom
// The fit sits this many zoom levels further out, so the first view shows more
// clusters around the listings.
const FIT_ZOOM_OUT = 0.75;

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1)
  );
  return sorted[idx];
}

// Groups listings whose pins overlap at the map's current zoom. Returns
// { members, lng, lat } per pin (lng/lat is the members' average). The pinned
// listing (the selected one) is never merged, so its larger pin stays visible.
function clusterListings(map, listings, pinnedId) {
  const toGroup = (members) => ({
    members,
    lng: members.reduce((sum, l) => sum + l.longitude, 0) / members.length,
    lat: members.reduce((sum, l) => sum + l.latitude, 0) / members.length,
  });
  const pinned = listings.filter((l) => String(l._id) === String(pinnedId));
  const pool = listings.filter((l) => !pinned.includes(l));
  const radius = map.getZoom() < CLUSTER_MAX_ZOOM ? CLUSTER_RADIUS_PX : 0;
  const points = pool.map((l) => map.project([l.longitude, l.latitude]));
  const taken = new Set();
  const groups = pinned.map((l) => toGroup([l]));
  pool.forEach((listing, i) => {
    if (taken.has(i)) return;
    taken.add(i);
    const members = [listing];
    for (let j = i + 1; j < pool.length; j++) {
      if (
        !taken.has(j) &&
        Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) <
          radius
      ) {
        taken.add(j);
        members.push(pool[j]);
      }
    }
    groups.push(toGroup(members));
  });
  return groups;
}

// Pin for two or more merged listings: the pin shape with the count where the
// star would be. Grey only when every listing is unavailable, else the normal
// red, with the suggested badge if any listing in it is suggested.
function buildClusterPinElement(count, isUnavailable, hasSuggested) {
  const color = isUnavailable ? UNAVAILABLE_PIN_COLOR : AVAILABLE_PIN_COLOR;
  const badge = hasSuggested && !isUnavailable ? SUGGESTED_BADGE : "";
  // The Figma count is 20px bold with its baseline at 25; longer counts shrink
  // to fit the pin and keep the same vertical center.
  const fontSize = count > 99 ? 12 : count > 9 ? 16 : 20;
  const baseline = (17.75 + fontSize * 0.3636).toFixed(2);
  const el = document.createElement("div");
  el.style.cssText = "width:30px;height:42px;user-select:none;";
  el.innerHTML = pinMarkup(
    color,
    `<text x="15" y="${baseline}" text-anchor="middle" fill="white" font-size="${fontSize}" font-weight="700">${count}</text>${badge}`
  );
  return el;
}

export default function MapView(props) {
  return (
    <MapErrorBoundary className="w-full h-full">
      <MapViewInner {...props} />
    </MapErrorBoundary>
  );
}

function MapViewInner({
  listings = [],
  filters,
  setFilters,
  handleReset,
  onListingSelect,
  selectedListingId,
  searchLocation = null,
  onSearchLocationConsumed = null,
  isActive = true,
  // The map is kept alive but is not on screen (browse page with the map
  // hidden). It has no size then, so it does no pin or camera work, and picks up
  // where it left off, with the current listings and selection, when shown.
  paused = false,
  heroMode = false,
  onBrowseArea = null,
  panelExpanded = false,
  // Ticks each time the listings column finishes its width slide.
  panelSlideEnd = 0,
  // Set of listing ids in the browse "Suggested for you" strip; their pins get
  // a gold badge so the strip can be found on the map.
  suggestedIds = null,
}) {
  const router = useRouter();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  // Set by a pin click, read when the panel next opens or closes: a close
  // caused by a pin flies onto that pin; any other close leaves the map where
  // it is.
  const pinClickedRef = useRef(false);
  // Where to fly onto a pin picked as the panel closed, held until the column's
  // slide ends (see the panelSlideEnd effect).
  const pendingPinRef = useRef(null);
  const listingsRef = useRef(listings);
  // Pins outlive a re-render of the listings (see renderPins), so a pin's click
  // reads the current handler and the current listing object from refs.
  const onListingSelectRef = useRef(onListingSelect);
  onListingSelectRef.current = onListingSelect;
  // Set synchronously at the top of the panelExpanded effect so the
  // selectedListingId effect (which runs after, in definition order) can
  // read it and skip its own flyTo.
  const panelIsTransitioningRef = useRef(false);
  const [showExplore, setShowExplore] = useState(false);
  const [showBrowseButton, setShowBrowseButton] = useState(false);
  const [showShuttleStops, setShowShuttleStops] = useState(false);
  const [hideUnavailable, setHideUnavailable] = useState(false);
  // The selection as the pins last saw it, and the pin renderer of the current
  // marker effect (null while there is none): a selection change re-renders the
  // pins through it rather than re-running that effect, so the pins that did
  // not change are kept (see renderPins).
  const selectedRef = useRef(selectedListingId);
  const renderPinsRef = useRef(null);
  const [activeRouteId, setActiveRouteId] = useState(null);

  // Function to calculate distance between two points using Haversine formula
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 3959; // Radius of Earth in miles
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
  };

  // Function to show route to campus
  const showRouteToCampus = useCallback(async (listingCoords, listingId) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing route if any
    if (map.getLayer("route")) {
      map.removeLayer("route");
    }
    if (map.getSource("route")) {
      map.removeSource("route");
    }

    try {
      // Get route from Mapbox Directions API
      const query = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${listingCoords[0]},${listingCoords[1]};${WASHU_CAMPUS_CENTER.longitude},${WASHU_CAMPUS_CENTER.latitude}?geometries=geojson&access_token=${mapboxgl.accessToken}`
      );
      const json = await query.json();
      const route = json.routes[0];

      if (route) {
        // Add route layer
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: route.geometry,
          },
        });

        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": "#ef4444",
            "line-width": 6,
            "line-opacity": 0.8,
          },
        });

        // Add campus marker if not exists
        if (!map.getLayer("campus-marker")) {
          map.addSource("campus-marker", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [
                      WASHU_CAMPUS_CENTER.longitude,
                      WASHU_CAMPUS_CENTER.latitude,
                    ],
                  },
                  properties: {
                    title: "WashU Campus",
                  },
                },
              ],
            },
          });

          map.addLayer({
            id: "campus-marker",
            type: "circle",
            source: "campus-marker",
            paint: {
              "circle-radius": 12,
              "circle-color": "#1d4ed8",
              "circle-stroke-width": 3,
              "circle-stroke-color": "#ffffff",
            },
          });
        }

        setActiveRouteId(listingId);
      }
    } catch (error) {
      console.error("Error fetching route:", error);
    }
  }, []);

  // Function to hide route
  const hideRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getLayer("route")) {
      map.removeLayer("route");
    }
    if (map.getSource("route")) {
      map.removeSource("route");
    }
    if (map.getLayer("campus-marker")) {
      map.removeLayer("campus-marker");
    }
    if (map.getSource("campus-marker")) {
      map.removeSource("campus-marker");
    }
    setActiveRouteId(null);
  }, []);

  useEffect(() => {
    if (!isActive) return;
    // Initialize the map once on mount and clean it up on unmount.
    if (!mapContainerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v11",
        center: [-90.3035, 38.6495],
        zoom: 15.5,
      });
      if (!heroMode) {
        mapRef.current.addControl(new mapboxgl.NavigationControl());
      }

      // Show "Browse this area" button on user-initiated map movement
      if (!heroMode && onBrowseArea) {
        mapRef.current.on("movestart", (e) => {
          if (e.originalEvent) setShowBrowseButton(true);
        });
      }

      // Resize map after initialization to ensure proper fit
      mapRef.current.once("load", () => {
        if (mapRef.current) {
          mapRef.current.resize();
        }
      });

      // Pins carry a z-index (south on top). Keep that stacking inside the
      // marker layer so pins never cover the map controls or the buttons.
      mapRef.current.getCanvasContainer().style.isolation = "isolate";
    }

    if (!heroMode) {
      // Expose route helpers (only for the active/visible map)
      window.showRouteToCampus = showRouteToCampus;
      window.hideRoute = hideRoute;
    }

    // Hero mode: show Explore button on first user interaction
    const container = mapContainerRef.current;
    const onUserInput = heroMode ? () => setShowExplore(true) : null;
    if (heroMode && onUserInput) {
      container.addEventListener("mousedown", onUserInput, { once: true });
      container.addEventListener("touchstart", onUserInput, { once: true });
      container.addEventListener("wheel", onUserInput, { once: true });
    }

    // Mapbox resizes itself on window resize, but not when the container
    // changes size on its own (the browse panel opening or closing), which can
    // leave the canvas at a stale width. Watch the container and resize at most
    // once per frame. Deferred to the next frame rather than run inside the
    // callback: resizing the canvas inside the observed box can otherwise
    // trip a "ResizeObserver loop" error when the box is sized by its content.
    let resizeFrame = null;
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (resizeFrame != null) return;
            resizeFrame = requestAnimationFrame(() => {
              resizeFrame = null;
              mapRef.current?.resize();
            });
          })
        : null;
    resizeObserver?.observe(container);

    return () => {
      if (!heroMode) {
        delete window.showRouteToCampus;
        delete window.hideRoute;
      } else if (onUserInput) {
        container.removeEventListener("mousedown", onUserInput);
        container.removeEventListener("touchstart", onUserInput);
        container.removeEventListener("wheel", onUserInput);
      }

      resizeObserver?.disconnect();
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame);

      // Runs on unmount AND whenever a dependency changes (isActive flips when
      // the viewport crosses the md breakpoint), so the map is rebuilt then too.
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [isActive, heroMode, showRouteToCampus, hideRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  // Builds a flat pin element for one listing (Figma design).
  // rating: exact float (e.g. 3.7) or null; a rated pin shows a star filled
  //   from the bottom up by the rating, an unrated one a dot
  // isActive: the selected pin, same design drawn larger
  // isSuggested: adds the gold badge for "Suggested for you" listings
  // isUnavailable: grey body and star, with no badge
  function buildPinSVGElement(
    rating,
    listingId,
    isActive,
    isSuggested = false,
    isUnavailable = false
  ) {
    const el = document.createElement("div");
    el.style.cssText = "width:30px;height:42px;";

    const bodyColor = isUnavailable
      ? UNAVAILABLE_PIN_COLOR
      : AVAILABLE_PIN_COLOR;
    const badge = isSuggested && !isUnavailable ? SUGGESTED_BADGE : "";
    const markColor = isUnavailable ? UNAVAILABLE_STAR_COLOR : "white";
    const scale = isActive ? SELECTED_PIN_SCALE : 1;

    if (!(rating != null && rating > 0)) {
      el.innerHTML = pinMarkup(
        bodyColor,
        `<circle cx="15" cy="15.2" r="4.5" fill="${markColor}"/>${badge}`,
        scale
      );
      return el;
    }

    // The outline is always whole; the fill is the same star clipped from the
    // bottom up to the rating (a 5.0 fills it, a 2.5 fills the lower half).
    const safeId = String(listingId).replace(/[^a-zA-Z0-9]/g, "_");
    const fillHeight = (Math.min(rating, 5) / 5) * (STAR_BOTTOM - STAR_TOP);
    const clipY = (STAR_BOTTOM - fillHeight).toFixed(2);
    el.innerHTML = pinMarkup(
      bodyColor,
      `<defs>
        <clipPath id="sc_${safeId}">
          <rect x="4" y="${clipY}" width="22" height="${(fillHeight + 1).toFixed(2)}"/>
        </clipPath>
      </defs>
      <path d="${STAR_PATH}" stroke="${markColor}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${STAR_PATH}" fill="${markColor}" stroke="${markColor}" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#sc_${safeId})"/>${badge}`,
      scale
    );
    return el;
  }

  // Coming back on screen: take the container's size before anything below
  // (pins, fit) uses it. Defined first so it runs first.
  useEffect(() => {
    if (isActive && !paused) mapRef.current?.resize();
  }, [isActive, paused]);

  // Separate effect: update markers and layers without recreating/removing the map itself.
  useEffect(() => {
    if (!isActive || paused) return;
    const map = mapRef.current;
    if (!map) return;

    // Update the markers. Runs on every frame of a zoom (which listings merge
    // into a cluster depends on it), so pins group and split live, on every
    // selection change (the selected listing is never merged) and whenever the
    // listings change. A pin that comes out the same, with the same listings
    // and the same look, is kept as it is; only the others are removed or
    // built. So a new listings array holding the same listings (saving one
    // re-runs the filters) leaves every pin where it is.
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    // Pins still fading out. Mapbox keeps positioning them until removed.
    const leaving = new Set();
    const motionEl = (marker) => marker.getElement().firstElementChild;
    // Screen offset from one pin to another, as a CSS translate.
    const offsetTo = (from, to) => {
      const a = map.project(from.getLngLat());
      const b = map.project(to.getLngLat());
      return `translate(${(b.x - a.x).toFixed(1)}px, ${(b.y - a.y).toFixed(1)}px)`;
    };
    const sizeOf = (marker) => (marker._selected ? SELECTED_PIN_SCALE : 1);

    // A new pin. `source` is the pin its first listing was in before. The same
    // listing changing state (selected or not) grows or shrinks in place; a pin
    // split off a larger group slides out of it; anything else fades in.
    const animateIn = (marker, source) => {
      if (reduceMotion) return;
      if (source && !source._cluster && !marker._cluster) {
        motionEl(marker).animate(
          [
            { transform: `scale(${sizeOf(source) / sizeOf(marker)})` },
            { transform: "none" },
          ],
          PIN_MOTION
        );
        return;
      }
      const split = source && source._members.length > marker._members.length;
      motionEl(marker).animate(
        [
          {
            opacity: 0,
            transform: `${split ? offsetTo(marker, source) : ""} scale(0.6)`,
          },
          { opacity: 1, transform: "none" },
        ],
        PIN_MOTION
      );
    };

    // A pin that is going away. `target` is the pin its first listing is in
    // now. A pin joining a larger group slides into it while fading; anything
    // else fades where it is.
    const animateOut = (marker, target) => {
      const sameListing = target && !target._cluster && !marker._cluster;
      if (reduceMotion || sameListing) {
        marker.remove();
        return;
      }
      const merge = target && target._members.length > marker._members.length;
      marker.getElement().style.pointerEvents = "none";
      leaving.add(marker);
      const done = () => {
        leaving.delete(marker);
        marker.remove();
      };
      const animation = motionEl(marker).animate(
        [
          { opacity: 1, transform: "none" },
          {
            opacity: 0,
            transform: `${merge ? offsetTo(marker, target) : ""} scale(0.6)`,
          },
        ],
        { ...PIN_MOTION, fill: "forwards" }
      );
      animation.onfinish = done;
      animation.oncancel = done;
    };

    const renderPins = () => {
      const selectedId = selectedRef.current;
      const previous = new Map((map.markers ?? []).map((m) => [m._key, m]));
      // Which pin each listing was in before this render.
      const cameFrom = new Map();
      previous.forEach((m) =>
        m._members.forEach((l) => cameFrom.set(l._id, m))
      );
      const added = [];

      // Hidden unavailable listings take no part in clusters (count or color).
      const shown = listings.filter(
        (l) => l.longitude && l.latitude && !(hideUnavailable && l.unavailable)
      );
      map.markers = clusterListings(map, shown, selectedId).map(
        ({ members, lng, lat }) => {
          const isCluster = members.length > 1;
          const listing = members[0];
          const isSelected = !isCluster && listing._id === selectedId;
          const exactRating =
            (listing.rating || 0) > 0 ? listing.rating || 0 : null;
          const allUnavailable = members.every((l) => l.unavailable);
          const anySuggested = members.some((l) =>
            suggestedIds?.has(String(l._id))
          );
          // The listings in the pin plus everything that changes how it looks.
          const look = `${allUnavailable}:${anySuggested}`;
          const key = isCluster
            ? `${members.map((l) => l._id).join(",")}:${look}`
            : `${listing._id}:${isSelected}:${exactRating}:${look}`;
          const kept = previous.get(key);
          if (kept) {
            previous.delete(key);
            kept._members = members;
            return kept;
          }
          const markerEl = isCluster
            ? buildClusterPinElement(members.length, allUnavailable, anySuggested)
            : buildPinSVGElement(
                exactRating,
                listing._id,
                isSelected,
                anySuggested,
                allUnavailable
              );
          markerEl.style.cursor =
            isCluster || onListingSelect ? "pointer" : "default";
          // Grow under the pointer, on the wrapper that holds the pin's size
          // (it has the transition, so the growth and the shrink are smooth).
          const sizeEl = markerEl.firstElementChild.firstElementChild;
          const baseScale = isSelected ? SELECTED_PIN_SCALE : 1;
          markerEl.addEventListener("mouseenter", () => {
            sizeEl.style.transform = `scale(${baseScale * HOVER_PIN_GROWTH})`;
          });
          markerEl.addEventListener("mouseleave", () => {
            sizeEl.style.transform = `scale(${baseScale})`;
          });
          const marker = new mapboxgl.Marker({
            element: markerEl,
            anchor: "bottom",
          })
            .setLngLat([lng, lat])
            .addTo(map);
          // Southern pins on top of northern ones, single or grouped alike;
          // only the selected pin sits above them all. Set after addTo, on the
          // element Mapbox positions.
          markerEl.style.zIndex = isSelected ? TOP_PIN_Z_INDEX : pinZIndex(lat);
          marker._key = key;
          marker._members = members;
          marker._cluster = isCluster;
          marker._selected = isSelected;
          added.push(marker);
          if (isCluster) {
            markerEl.addEventListener("click", () => {
              map.easeTo({
                center: [lng, lat],
                zoom: Math.min(
                  CLUSTER_MAX_ZOOM,
                  map.getZoom() + CLUSTER_ZOOM_STEP
                ),
                duration: 600,
              });
            });
          } else if (onListingSelect) {
            markerEl.addEventListener("click", () => {
              pinClickedRef.current = true;
              onListingSelectRef.current?.(
                listingsRef.current.find((l) => l._id === listing._id) ??
                  listing
              );
            });
          }
          return marker;
        }
      );

      // Which pin each listing is in now, then move the changed pins.
      const wentTo = new Map();
      map.markers.forEach((m) =>
        m._members.forEach((l) => wentTo.set(l._id, m))
      );
      added.forEach((marker) =>
        animateIn(marker, cameFrom.get(marker._members[0]._id))
      );
      previous.forEach((marker) =>
        animateOut(marker, wentTo.get(marker._members[0]._id))
      );
    };
    renderPinsRef.current = renderPins;
    renderPins();
    map.on("zoom", renderPins);

    // Zoom to fit all visible listings whenever the SET of listings changes.
    // Keyed on the ids, not the array: the feed refetch after first paint hands
    // back a new array with the same listings, and refitting on that pulled the
    // camera out from a ?panel= deep link it had just flown to. A real change
    // (a filter) still refits, panel open or not. Stored on the map so a
    // recreated map gets its own first fit.
    const valid = listings.filter((l) => l.longitude && l.latitude);
    const fitKey = valid
      .map((l) => String(l._id))
      .sort()
      .join(",");
    if (valid.length > 0 && map._fitKey !== fitKey) {
      map._fitKey = fitKey;
      const campusLng = WASHU_CAMPUS_CENTER.longitude;
      const campusLat = WASHU_CAMPUS_CENTER.latitude;
      // Radius that contains FIT_PERCENTILE of the listings, not all of them.
      const deltaLng = Math.max(
        FIT_MIN_DELTA_DEG,
        percentile(
          valid.map((l) => Math.abs(l.longitude - campusLng)),
          FIT_PERCENTILE
        )
      );
      const deltaLat = Math.max(
        FIT_MIN_DELTA_DEG,
        percentile(
          valid.map((l) => Math.abs(l.latitude - campusLat)),
          FIT_PERCENTILE
        )
      );
      const symBounds = [
        [campusLng - deltaLng, campusLat - deltaLat],
        [campusLng + deltaLng, campusLat + deltaLat],
      ];
      const doFit = () => {
        const camera = map.cameraForBounds(symBounds, {
          padding: 48,
          maxZoom: 15.5,
        });
        map.flyTo({
          center: [campusLng, campusLat],
          zoom: (camera ? camera.zoom : 13) - FIT_ZOOM_OUT,
          duration: 1400,
          essential: true,
        });
      };
      // cameraForBounds/flyTo only need the map transform (container size),
      // not a loaded style. Gating on "load" here used to silently skip the
      // fit whenever the style resolved after the listings did.
      doFit();
    }

    const shuttleGeoJSON = {
      type: "FeatureCollection",
      features: SHUTTLE_STOPS.map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: { name: s.name },
      })),
    };

    const addShuttleStops = () => {
      if (!map.getSource("shuttle-stops")) {
        map.addSource("shuttle-stops", {
          type: "geojson",
          data: shuttleGeoJSON,
        });
      }
      if (!map.getLayer("shuttle-stops-layer")) {
        map.addLayer({
          id: "shuttle-stops-layer",
          type: "circle",
          source: "shuttle-stops",
          paint: {
            "circle-radius": 4,
            "circle-color": "#14b8a6",
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 0.85,
          },
        });
        map.on("click", "shuttle-stops-layer", (e) => {
          const name = e.features[0].properties.name;
          new mapboxgl.Popup({ closeButton: false, offset: 10 })
            .setLngLat(e.features[0].geometry.coordinates)
            .setHTML(
              `<span style="font-size:12px;font-weight:600">${name}</span>`
            )
            .addTo(map);
        });
        map.on("mouseenter", "shuttle-stops-layer", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "shuttle-stops-layer", () => {
          map.getCanvas().style.cursor = "";
        });
      }
    };

    const removeShuttleStops = () => {
      if (map.getLayer("shuttle-stops-layer"))
        map.removeLayer("shuttle-stops-layer");
      if (map.getSource("shuttle-stops")) map.removeSource("shuttle-stops");
    };

    if (!map.isStyleLoaded()) {
      map.once("style.load", () => {
        showShuttleStops ? addShuttleStops() : removeShuttleStops();
      });
    } else {
      showShuttleStops ? addShuttleStops() : removeShuttleStops();
    }

    return () => {
      renderPinsRef.current = null;
      map.off("zoom", renderPins);
      leaving.forEach((marker) => marker.remove());
      leaving.clear();
      // The pins stay on the map: the next run keeps the ones that did not
      // change and only moves the rest. They go with the map itself, whose
      // removal is handled by the mount/unmount effect.
    };
  }, [
    isActive,
    listings,
    showShuttleStops,
    suggestedIds,
    hideUnavailable,
    paused,
  ]);

  // Keep listingsRef current so the selectedListingId effect can find coordinates
  useEffect(() => {
    listingsRef.current = listings;
  }, [listings]);

  // When the panel expands/collapses, the container ResizeObserver above keeps
  // the canvas following the CSS width transition. This effect only owns the
  // camera: it sets panelIsTransitioningRef = true SYNCHRONOUSLY so the
  // selectedListingId effect (defined below, runs after this one) skips its own
  // flyTo, then flies once the transition has finished and the map is at its
  // final size.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || paused) return;

    panelIsTransitioningRef.current = true;

    // Closing the panel by clicking a pin flies onto that pin once the slide
    // has ended. Any other close leaves the map where it is.
    const pickedPin = !panelExpanded && pinClickedRef.current;
    pinClickedRef.current = false;
    const pin =
      pickedPin &&
      listingsRef.current.find((l) => String(l._id) === String(selectedListingId));
    pendingPinRef.current =
      pin?.longitude && pin?.latitude
        ? {
            center: [pin.longitude, pin.latitude],
            zoom: Math.min(Math.max(map.getZoom(), 15), 16),
            offset: [0, -Math.round(map.getContainer().clientHeight * 0.2)],
          }
        : null;

    const TRANSITION_MS = 450; // the listings column's width slide (AvailableListings)
    const timer = setTimeout(() => {
      panelIsTransitioningRef.current = false;
      // If the panel just expanded with a listing active, fly to it now.
      if (panelExpanded && selectedListingId) {
        const listing = listingsRef.current.find(
          (l) => String(l._id) === String(selectedListingId)
        );
        if (listing?.longitude && listing?.latitude) {
          map.resize(); // one final sync before calculating offset
          map.flyTo({
            center: [listing.longitude, listing.latitude],
            zoom: Math.min(Math.max(map.getZoom(), 15), 16),
            offset: [0, -Math.round(map.getContainer().clientHeight * 0.2)],
            duration: 700,
            essential: true,
          });
        }
      }
    }, TRANSITION_MS + 16);

    return () => {
      clearTimeout(timer);
      panelIsTransitioningRef.current = false;
    };
  }, [panelExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly onto the pin picked as the panel closed once the column's width slide
  // has ended (panelSlideEnd ticks), not on a timer: flown mid-slide, the camera
  // lands in a narrower map and ends off-centre when the map then widens.
  useEffect(() => {
    const map = mapRef.current;
    const target = pendingPinRef.current;
    if (!map || !target) return;
    pendingPinRef.current = null;
    map.resize();
    map.flyTo({ ...target, duration: 700, essential: true });
  }, [panelSlideEnd]);

  // A new selection: render the pins again, which draws the selected one larger,
  // lifts it above its neighbours and pulls it out of any cluster. Runs in hero
  // mode too: the homepage map shows the same pins and pops the same card on a
  // click, so the pin you picked is the one lit up there as well.
  useEffect(() => {
    selectedRef.current = selectedListingId;
    renderPinsRef.current?.();
  }, [selectedListingId]);

  // Fly to the listing when the SELECTION changes. Skips flyTo when the panel
  // is mid-transition: the panelExpanded effect above fires it once the map has
  // settled at its final size. Runs in hero mode too, so clicking a pin on the
  // homepage zooms to it the way it does on browse. Deselecting leaves the
  // camera where the reader put it.
  useEffect(() => {
    if (!isActive || paused) return;
    const map = mapRef.current;
    if (!map?.markers) return;

    if (selectedListingId) {
      // panelExpanded effect set this flag synchronously before we ran —
      // hand off camera control to it so flyTo uses final map dimensions.
      if (panelIsTransitioningRef.current) return;

      const listing = listingsRef.current.find(
        (l) => String(l._id) === String(selectedListingId)
      );
      if (listing?.longitude && listing?.latitude) {
        map.flyTo({
          center: [listing.longitude, listing.latitude],
          zoom: Math.min(Math.max(map.getZoom(), 15), 16),
          offset: [0, -Math.round(map.getContainer().clientHeight * 0.2)],
          duration: 700,
          essential: true,
        });
      }
    }
  }, [isActive, paused, selectedListingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleShuttleStops = useCallback(() => {
    setShowShuttleStops((v) => !v);
  }, []);

  // Zoom to a searched address (?lat=&lng=) and drop a dot marker — regardless
  // of whether a listing sits there. Once the camera settles we notify the
  // parent so it can strip the params; otherwise any later re-render would
  // re-fire this zoom and hijack the user's browsing.
  useEffect(() => {
    if (!isActive || paused) return;
    const map = mapRef.current;
    if (!map || !searchLocation) return;

    let settledHandler = null;

    const process = () => {
      if (map._searchMarker) {
        map._searchMarker.remove();
        map._searchMarker = null;
      }

      const { lat, lng } = searchLocation;

      const el = document.createElement("div");
      el.style.cssText =
        "width:14px;height:14px;background:#1a1a1a;border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:default;";
      // Above every listing pin, so the searched spot is never hidden by one.
      el.style.zIndex = TOP_PIN_Z_INDEX + 1;
      map._searchMarker = new mapboxgl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);

      // Hand control back to /browse only after the camera has actually
      // arrived at the searched address. Other movements (the view-switch
      // resize on mobile, the fit-to-listings flyTo) also fire moveend, so we
      // ignore any that aren't centered on the target — otherwise the URL is
      // cleared mid-flight and the zoom looks like it instantly reverts.
      settledHandler = () => {
        const c = map.getCenter();
        if (Math.abs(c.lng - lng) > 1e-4 || Math.abs(c.lat - lat) > 1e-4) {
          return;
        }
        map.off("moveend", settledHandler);
        settledHandler = null;
        onSearchLocationConsumed?.();
      };
      map.on("moveend", settledHandler);
      map.flyTo({
        center: [lng, lat],
        zoom: 16,
        duration: 1000,
        essential: true,
      });
    };

    if (map.isStyleLoaded()) process();
    else map.once("load", process);

    return () => {
      if (settledHandler) map.off("moveend", settledHandler);
    };
  }, [isActive, paused, searchLocation]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
      {!heroMode && (
        <button
          onClick={() => setHideUnavailable((hidden) => !hidden)}
          className="absolute top-5 left-[72px] md:top-3 md:left-3 z-10 px-2.5 py-1.5 text-[11px] font-medium rounded-full shadow border bg-white text-gray-700 border-gray-200 hover:bg-gray-50 transition-colors"
        >
          {hideUnavailable
            ? "Show Unavailable Housing"
            : "Hide Unavailable Housing"}
        </button>
      )}
      {!heroMode && (
        <div className="absolute bottom-8 right-3 z-10 flex flex-col gap-1.5">
          <button
            onClick={handleToggleShuttleStops}
            className={`px-2.5 py-1.5 text-[11px] font-medium rounded-full shadow border transition-colors ${
              showShuttleStops
                ? "bg-teal-500 text-white border-teal-500"
                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {showShuttleStops ? "Hide Shuttle stops" : "Show Shuttle stops"}
          </button>
        </div>
      )}
      {!heroMode && onBrowseArea && (
        <div
          // With a listing open the map is only 42vw wide: below 1200px the
          // button goes under the Hide / Show Unavailable one rather than on it.
          className={`absolute top-16 left-1/2 z-10 transition-all duration-300 ${
            panelExpanded ? "md:top-12 min-[1200px]:top-3" : "md:top-3"
          }`}
          style={{
            opacity: showBrowseButton ? 1 : 0,
            transform: `translateX(-50%) translateY(${
              showBrowseButton ? "0" : "-8px"
            })`,
            pointerEvents: showBrowseButton ? "auto" : "none",
          }}
        >
          <button
            onClick={() => {
              const map = mapRef.current;
              if (map) onBrowseArea(map.getBounds());
              setShowBrowseButton(false);
            }}
            className="px-4 py-2 bg-white text-gray-800 font-semibold text-xs rounded-full shadow-md border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            Browse this area
          </button>
        </div>
      )}
      {heroMode && (
        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 transition-all duration-300"
          style={{
            opacity: showExplore ? 1 : 0,
            transform: `translateX(-50%) translateY(${
              showExplore ? "0" : "12px"
            })`,
            pointerEvents: showExplore ? "auto" : "none",
          }}
        >
          <button
            onClick={() => router.push("/browse")}
            className="px-6 py-3 bg-white text-gray-900 font-semibold text-sm rounded-full shadow-lg border border-gray-200 hover:bg-gray-50 hover:shadow-xl transition-all duration-150"
          >
            Explore Map
          </button>
        </div>
      )}
    </div>
  );
}
