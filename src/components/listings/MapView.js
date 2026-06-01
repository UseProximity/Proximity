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

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// WashU Campus center coordinates (Danforth Campus)
const WASHU_CAMPUS_CENTER = {
  longitude: -90.3053,
  latitude: 38.6489,
};

function computeBoundsExcludingOutliers(listings) {
  if (listings.length === 0) return null;
  const lats = listings.map((l) => l.latitude);
  const lngs = listings.map((l) => l.longitude);
  const meanLat = lats.reduce((s, v) => s + v, 0) / lats.length;
  const meanLng = lngs.reduce((s, v) => s + v, 0) / lngs.length;
  const stdLat = Math.sqrt(
    lats.reduce((s, v) => s + (v - meanLat) ** 2, 0) / lats.length
  );
  const stdLng = Math.sqrt(
    lngs.reduce((s, v) => s + (v - meanLng) ** 2, 0) / lngs.length
  );
  const filtered = listings.filter(
    (l) =>
      Math.abs(l.latitude - meanLat) <= 2 * (stdLat || 1) &&
      Math.abs(l.longitude - meanLng) <= 2 * (stdLng || 1)
  );
  const pool = filtered.length > 0 ? filtered : listings;
  return [
    [
      Math.min(...pool.map((l) => l.longitude)),
      Math.min(...pool.map((l) => l.latitude)),
    ],
    [
      Math.max(...pool.map((l) => l.longitude)),
      Math.max(...pool.map((l) => l.latitude)),
    ],
  ];
}

export default function MapView({
  listings = [],
  filters,
  setFilters,
  handleReset,
  onListingSelect,
  selectedListingId,
  searchLocation = null,
  onSearchLocationConsumed = null,
  isActive = true,
  heroMode = false,
  onBrowseArea = null,
  panelExpanded = false,
}) {
  const router = useRouter();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const preSelectZoomRef = useRef(null);
  const listingsRef = useRef(listings);
  // Set synchronously at the top of the panelExpanded effect so the
  // selectedListingId effect (which runs after, in definition order) can
  // read it and skip its own flyTo.
  const panelIsTransitioningRef = useRef(false);
  const [showExplore, setShowExplore] = useState(false);
  const [showBrowseButton, setShowBrowseButton] = useState(false);
  const [showShuttleStops, setShowShuttleStops] = useState(false);
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

    // Handle window resize
    const handleResize = () => {
      if (mapRef.current) {
        mapRef.current.resize();
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      if (!heroMode) {
        delete window.showRouteToCampus;
        delete window.hideRoute;
      } else if (onUserInput) {
        container.removeEventListener("mousedown", onUserInput);
        container.removeEventListener("touchstart", onUserInput);
        container.removeEventListener("wheel", onUserInput);
      }

      // Remove resize listener
      window.removeEventListener("resize", handleResize);

      // Only remove the map on unmount
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [isActive, heroMode, showRouteToCampus, hideRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  // Builds an inline-SVG pin element with a dynamically clipped star fill.
  // rating: exact float (e.g. 3.7) or null for no-review pins
  // isActive: true = lighter/brighter active color scheme
  function buildPinSVGElement(rating, listingId, isActive) {
    const el = document.createElement("div");
    el.style.cssText = "width:35px;height:49px;";

    const safeId = String(listingId).replace(/[^a-zA-Z0-9]/g, "_");
    const hasRating = rating != null && rating > 0;

    const PIN_PATH =
      "M2.10342 24.897C4.01562 32.1187 12.8496 42.2217 17.49 47.001C22.6189 42.2217 30.6445 31.1218 32.8766 24.897C35.6237 17.2363 34.3335 1.67745 17.4901 1.00098C1.36353 1.67745 -0.827361 17.1308 2.10342 24.897Z";
    const STAR_PATH =
      "M17.0293 8.79004C17.1878 8.34883 17.8122 8.34883 17.9707 8.79004L20.4404 15.668C20.6507 16.2534 21.2013 16.6479 21.8232 16.6602L29.2773 16.8076C29.7553 16.817 29.9486 17.427 29.5635 17.71L23.6768 22.0293C23.1599 22.4086 22.9415 23.0747 23.1328 23.6865L25.2832 30.5664C25.4241 31.0173 24.9192 31.3935 24.5273 31.1299L18.3379 26.9619C17.8315 26.621 17.1685 26.621 16.6621 26.9619L10.4727 31.1299C10.0808 31.3935 9.57593 31.0173 9.7168 30.5664L11.8672 23.6865C12.0585 23.0747 11.8401 22.4086 11.3232 22.0293L5.43652 17.71C5.05135 17.427 5.24468 16.817 5.72266 16.8076L13.1768 16.6602C13.7987 16.6479 14.3493 16.2534 14.5596 15.668L17.0293 8.79004Z";

    if (!hasRating) {
      const pinBodyStop2 = isActive ? "#FFDFDF" : "#E8000B";
      const pinBodyOpacity = isActive ? ' stop-opacity="0.9"' : "";
      const circleFill = isActive ? "#FFA2A2" : "white";
      el.innerHTML = `<svg width="35" height="49" viewBox="0 0 35 49" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="pg_${safeId}" x1="17.5" y1="1" x2="17.5" y2="47" gradientUnits="userSpaceOnUse">
            <stop stop-color="white"/>
            <stop offset="0.18" stop-color="${pinBodyStop2}"${pinBodyOpacity}/>
          </linearGradient>
        </defs>
        <path d="${PIN_PATH}" fill="url(#pg_${safeId})" stroke="#E8000B" stroke-width="2"/>
        <circle cx="17.5" cy="20" r="5.5" fill="${circleFill}" opacity="0.9"/>
      </svg>`;
    } else {
      // Star y-bounds: top≈8.34, bottom≈31.4, height≈23. Clip from bottom up for fractional fill.
      const STAR_BOTTOM = 31.4;
      const STAR_HEIGHT = 23.06;
      const fillHeight = ((rating / 5) * STAR_HEIGHT).toFixed(2);
      const clipY = (STAR_BOTTOM - parseFloat(fillHeight)).toFixed(2);

      const pinBodyStop2 = isActive ? "#FFDFDF" : "#E8000B";
      const pinBodyOpacity = isActive ? ' stop-opacity="0.9"' : "";
      const starFill = isActive ? "#FFA2A2" : "#FFFFF6";
      const starStroke = isActive ? "#FFA2A2" : "#FFFFF6";

      el.innerHTML = `<svg width="35" height="49" viewBox="0 0 35 49" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="pg_${safeId}" x1="17.5" y1="1" x2="17.5" y2="47" gradientUnits="userSpaceOnUse">
            <stop stop-color="white"/>
            <stop offset="0.18" stop-color="${pinBodyStop2}"${pinBodyOpacity}/>
          </linearGradient>
          <clipPath id="sc_${safeId}">
            <rect x="4" y="${clipY}" width="27" height="${fillHeight}"/>
          </clipPath>
        </defs>
        <path d="${PIN_PATH}" fill="url(#pg_${safeId})" stroke="#E8000B" stroke-width="2"/>
        <path d="${STAR_PATH}" fill="${starFill}" clip-path="url(#sc_${safeId})"/>
        <path d="${STAR_PATH}" fill="none" stroke="${starStroke}" stroke-width="0.75"/>
      </svg>`;
    }

    return el;
  }

  // Separate effect: update markers and layers without recreating/removing the map itself.
  useEffect(() => {
    if (!isActive) return;
    const map = mapRef.current;
    if (!map) return;

    // Update markers: remove previous markers and add new ones
    if (map.markers) {
      map.markers.forEach((marker) => marker.remove());
    }
    map.markers = [];

    // Sort north-first so southern pins are added last and render on top
    const sortedListings = [...listings].sort(
      (a, b) => b.latitude - a.latitude
    );

    sortedListings.forEach((listing) => {
      if (!listing.longitude || !listing.latitude) return;

      const exactRating =
        (listing.rating || 0) > 0 ? listing.rating || 0 : null;
      const markerEl = buildPinSVGElement(exactRating, listing._id, false);
      markerEl.style.cursor = onListingSelect ? "pointer" : "default";
      const marker = new mapboxgl.Marker({
        element: markerEl,
        anchor: "bottom",
      })
        .setLngLat([listing.longitude, listing.latitude])
        .addTo(map);
      marker._listingId = listing._id;
      marker._rating = exactRating;
      if (onListingSelect) {
        markerEl.addEventListener("click", () => {
          onListingSelect(listing);
        });
      }
      map.markers.push(marker);
    });

    // Zoom to fit all visible listings whenever the listings set changes
    if (listings.length > 0) {
      const valid = listings.filter((l) => l.longitude && l.latitude);
      const bounds = computeBoundsExcludingOutliers(valid);
      if (bounds) {
        const campusLng = WASHU_CAMPUS_CENTER.longitude;
        const campusLat = WASHU_CAMPUS_CENTER.latitude;
        const maxDeltaLng = Math.max(
          Math.abs(campusLng - bounds[0][0]),
          Math.abs(bounds[1][0] - campusLng)
        );
        const maxDeltaLat = Math.max(
          Math.abs(campusLat - bounds[0][1]),
          Math.abs(bounds[1][1] - campusLat)
        );
        const symBounds = [
          [campusLng - maxDeltaLng, campusLat - maxDeltaLat],
          [campusLng + maxDeltaLng, campusLat + maxDeltaLat],
        ];
        const doFit = () => {
          const camera = map.cameraForBounds(symBounds, {
            padding: 80,
            maxZoom: 15,
          });
          map.flyTo({
            center: [campusLng, campusLat],
            zoom: camera ? camera.zoom : 13,
            duration: 1400,
            essential: true,
          });
        };
        if (map.isStyleLoaded()) doFit();
        else map.once("load", doFit);
      }
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
      // Cleanup only markers added by this effect. Do NOT remove the map instance here
      if (map.markers) {
        map.markers.forEach((marker) => marker.remove());
        map.markers = [];
      }
      // Keep global helpers and the map alive; map removal is handled by the mount/unmount effect
    };
  }, [isActive, listings, showShuttleStops]);

  // Keep listingsRef current so the selectedListingId effect can find coordinates
  useEffect(() => {
    listingsRef.current = listings;
  }, [listings]);

  // When the panel expands/collapses: resize the map canvas on every RAF frame so
  // it smoothly follows the CSS width transition.
  // Sets panelIsTransitioningRef = true SYNCHRONOUSLY before any RAF so the
  // selectedListingId effect (defined below, runs after this one) sees it and
  // skips its own flyTo. We own the flyTo here, fired once the resize is done.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    panelIsTransitioningRef.current = true;

    const TRANSITION_MS = 300;
    const start = performance.now();
    let rafId;

    function tick(now) {
      map.resize();
      if (now - start < TRANSITION_MS + 16) {
        rafId = requestAnimationFrame(tick);
      } else {
        // Transition finished — map is at its final dimensions.
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
      }
    }

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      panelIsTransitioningRef.current = false;
    };
  }, [panelExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync active marker icon + fly to listing when selectedListingId changes.
  // Skips flyTo when the panel is mid-transition — the panelExpanded effect
  // above will fire it once the map has settled at its final size.
  useEffect(() => {
    if (!isActive || heroMode) return;
    const map = mapRef.current;
    if (!map?.markers) return;
    map.markers.forEach((marker) => {
      const isActive = marker._listingId === selectedListingId;
      const el = marker.getElement();
      const newPin = buildPinSVGElement(
        marker._rating,
        marker._listingId,
        isActive
      );
      el.innerHTML = newPin.innerHTML;
    });
    // Re-establish correct south-on-top stacking, then pin selected last
    const sorted = [...map.markers].sort(
      (a, b) => b.getLngLat().lat - a.getLngLat().lat
    );
    sorted.forEach((marker) => {
      if (marker._listingId === selectedListingId) return;
      const el = marker.getElement();
      if (el?.parentNode) el.parentNode.appendChild(el);
    });
    if (selectedListingId) {
      const activeMarker = map.markers.find(
        (m) => m._listingId === selectedListingId
      );
      const el = activeMarker?.getElement();
      if (el?.parentNode) el.parentNode.appendChild(el);
    }

    if (selectedListingId) {
      // panelExpanded effect set this flag synchronously before we ran —
      // hand off camera control to it so flyTo uses final map dimensions.
      if (panelIsTransitioningRef.current) return;

      const listing = listingsRef.current.find(
        (l) => String(l._id) === String(selectedListingId)
      );
      if (listing?.longitude && listing?.latitude) {
        if (preSelectZoomRef.current == null) {
          preSelectZoomRef.current = map.getZoom();
        }
        map.flyTo({
          center: [listing.longitude, listing.latitude],
          zoom: Math.min(Math.max(map.getZoom(), 15), 16),
          offset: [0, -Math.round(map.getContainer().clientHeight * 0.2)],
          duration: 700,
          essential: true,
        });
      }
    } else if (preSelectZoomRef.current != null) {
      map.flyTo({ zoom: preSelectZoomRef.current, duration: 600 });
      preSelectZoomRef.current = null;
    }
  }, [isActive, selectedListingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleShuttleStops = useCallback(() => {
    setShowShuttleStops((v) => !v);
  }, []);

  // Zoom to a searched address (?lat=&lng=) and drop a dot marker — regardless
  // of whether a listing sits there. Once the camera settles we notify the
  // parent so it can strip the params; otherwise any later re-render would
  // re-fire this zoom and hijack the user's browsing.
  useEffect(() => {
    if (!isActive) return;
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
  }, [isActive, searchLocation]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
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
          className="absolute top-3 left-1/2 z-10 transition-all duration-300"
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
