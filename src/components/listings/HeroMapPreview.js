"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useRouter } from "next/navigation";
import { getRentRangeDisplay } from "@/utils/listingFormatters";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const CAMPUS_CENTER = [-90.3032, 38.6495];
const CARD_WIDTH = 180;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

export default function HeroMapPreview({
  listings = [],
  searchLocation = null,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [showExplore, setShowExplore] = useState(false);
  const [selectedListing, setSelectedListing] = useState(null);
  const selectedListingRef = useRef(null);
  const pinJustClickedRef = useRef(false);
  const router = useRouter();

  // Init map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const isMobileDevice = window.innerWidth < 768;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: CAMPUS_CENTER,
      zoom: 15.5,
      cooperativeGestures: isMobileDevice,
      locale: {
        "ScrollZoomBlocker.CtrlMessage": "Use two fingers to move the map",
        "ScrollZoomBlocker.CmdMessage": "Use two fingers to move the map",
      },
    });

    mapRef.current = map;
    map.on("load", () => map.resize());

    // Clicking the map background closes the card (skip if a pin was just clicked)
    map.on("click", () => {
      if (pinJustClickedRef.current) {
        pinJustClickedRef.current = false;
        return;
      }
      selectedListingRef.current = null;
      setSelectedListing(null);
    });

    // Show explore button only on real user input (not programmatic flyTo)
    const onUserInput = () => setShowExplore(true);
    const container = mapContainerRef.current;
    container.addEventListener("mousedown", onUserInput, { once: true });
    container.addEventListener("touchstart", onUserInput, { once: true });
    container.addEventListener("wheel", onUserInput, { once: true });

    return () => {
      container.removeEventListener("mousedown", onUserInput);
      container.removeEventListener("touchstart", onUserInput);
      container.removeEventListener("wheel", onUserInput);
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Add markers whenever listings arrive
  useEffect(() => {
    const map = mapRef.current;
    if (!map || listings.length === 0) return;

    const addMarkers = () => {
      if (map._heroMarkers) map._heroMarkers.forEach((m) => m.remove());
      map._heroMarkers = [];

      // Sort north-first so southern pins render on top
      const valid = [...listings]
        .filter((l) => l.longitude && l.latitude)
        .sort((a, b) => b.latitude - a.latitude);

      valid.forEach((listing) => {
        const starRating = Math.min(
          Math.max(Math.round(listing.rating || 5), 1),
          5
        );
        const markerEl = document.createElement("div");
        markerEl.style.cssText = "width:36px;height:44px;cursor:pointer;";
        const markerImg = document.createElement("img");
        markerImg.src = `/assets/map-icons/map-${starRating}.svg`;
        markerImg.style.cssText = "width:100%;height:100%;";
        markerEl.appendChild(markerImg);

        const marker = new mapboxgl.Marker({ element: markerEl })
          .setLngLat([listing.longitude, listing.latitude])
          .addTo(map);
        marker._listing = listing;
        marker._markerImg = markerImg;
        marker._starRating = starRating;

        markerEl.addEventListener("click", () => {
          pinJustClickedRef.current = true; // prevent map click from closing the card

          // Reset previous active pin icon
          if (
            map._activeMarker &&
            map._activeMarker !== marker
          ) {
            const prev = map._activeMarker;
            prev._markerImg.src = `/assets/map-icons/map-${prev._starRating}.svg`;
          }

          markerImg.src = `/assets/map-icons/map-${starRating}-a.svg`;
          map._activeMarker = marker;

          selectedListingRef.current = listing;
          setSelectedListing(listing);

          // Zoom in and center on pin
          const targetZoom = Math.max(map.getZoom(), 16);
          map.flyTo({
            center: [listing.longitude, listing.latitude],
            zoom: targetZoom,
            duration: 500,
            essential: true,
          });
        });

        map._heroMarkers.push(marker);
      });

      // Frame all listings on initial load
      const bounds = computeBoundsExcludingOutliers(valid);
      if (bounds) {
        const maxDeltaLng = Math.max(
          Math.abs(CAMPUS_CENTER[0] - bounds[0][0]),
          Math.abs(bounds[1][0] - CAMPUS_CENTER[0])
        );
        const maxDeltaLat = Math.max(
          Math.abs(CAMPUS_CENTER[1] - bounds[0][1]),
          Math.abs(bounds[1][1] - CAMPUS_CENTER[1])
        );
        const symBounds = [
          [CAMPUS_CENTER[0] - maxDeltaLng, CAMPUS_CENTER[1] - maxDeltaLat],
          [CAMPUS_CENTER[0] + maxDeltaLng, CAMPUS_CENTER[1] + maxDeltaLat],
        ];
        const camera = map.cameraForBounds(symBounds, {
          padding: 80,
          maxZoom: 15,
        });
        map.flyTo({
          center: CAMPUS_CENTER,
          zoom: camera ? camera.zoom : 13,
          duration: 1400,
          essential: true,
        });
      }
    };

    if (map.isStyleLoaded()) {
      addMarkers();
    } else {
      map.once("load", addMarkers);
    }
  }, [listings]);

  // Zoom to a searched address and show appropriate pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !searchLocation) return;

    const process = () => {
      if (map._searchMarker) {
        map._searchMarker.remove();
        map._searchMarker = null;
      }

      const { lat, lng } = searchLocation;
      const match = map._heroMarkers?.find((m) => {
        const l = m._listing;
        return (
          l?.latitude &&
          l?.longitude &&
          haversineMeters(lat, lng, l.latitude, l.longitude) <= 80
        );
      });

      if (match) {
        map.flyTo({ center: [lng, lat], zoom: 16, duration: 900 });
        setTimeout(() => {
          selectedListingRef.current = match._listing;
          setSelectedListing(match._listing);
          match._markerImg.src = `/assets/map-icons/map-${match._starRating}-a.svg`;
          map._activeMarker = match;
        }, 950);
      } else {
        map.flyTo({ center: [lng, lat], zoom: 14, duration: 900 });
        const el = document.createElement("div");
        el.style.cssText =
          "width:14px;height:14px;background:#1a1a1a;border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:default;";
        map._searchMarker = new mapboxgl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);
      }
    };

    if (map.isStyleLoaded()) process();
    else map.once("load", process);
  }, [searchLocation]);

  const rentDisplay = selectedListing
    ? getRentRangeDisplay(selectedListing.unitTypes)
    : null;

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Listing card pinned below the clicked pin */}
      {selectedListing && (
        <div
          onClick={() => router.push(`/browse?listing=${selectedListing._id}`)}
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            width: CARD_WIDTH,
            zIndex: 50,
            cursor: "pointer",
            pointerEvents: "auto",
            borderRadius: 12,
            boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
            border: "1px solid rgba(226,232,240,0.8)",
            overflow: "hidden",
            background: "#fff",
            fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
          }}
        >
          {selectedListing.images?.[0] ? (
            <img
              src={selectedListing.images[0]}
              alt=""
              style={{ width: "100%", height: 90, objectFit: "cover", display: "block" }}
            />
          ) : (
            <div style={{ width: "100%", height: 90, background: "#e5e7eb" }} />
          )}
          <div style={{ padding: "8px 10px 10px" }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 12,
                color: "#111",
                lineHeight: 1.3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {selectedListing.address ? selectedListing.address.split(",")[0] : ""}
            </div>
            <div style={{ fontWeight: 700, fontSize: 12, color: "#ef4444", marginTop: 2 }}>
              {rentDisplay?.hasPrice ? (
                <>
                  {rentDisplay.label}
                  <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}>
                    {" "}/mo
                  </span>
                </>
              ) : (
                rentDisplay?.label || "N/A"
              )}
            </div>
          </div>
        </div>
      )}

      {/* Explore Map button */}
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
    </div>
  );
}
