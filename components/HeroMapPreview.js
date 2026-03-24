"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useRouter } from "next/navigation";
import { getRentRangeLabel } from "@/utils/listingFormatters";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const CAMPUS_CENTER = [-90.3032, 38.6495];

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Compute a bounding box over listings, excluding outliers beyond 2 std deviations
function computeBoundsExcludingOutliers(listings) {
  if (listings.length === 0) return null;

  const lats = listings.map((l) => l.latitude);
  const lngs = listings.map((l) => l.longitude);

  const meanLat = lats.reduce((s, v) => s + v, 0) / lats.length;
  const meanLng = lngs.reduce((s, v) => s + v, 0) / lngs.length;
  const stdLat = Math.sqrt(lats.reduce((s, v) => s + (v - meanLat) ** 2, 0) / lats.length);
  const stdLng = Math.sqrt(lngs.reduce((s, v) => s + (v - meanLng) ** 2, 0) / lngs.length);

  const filtered = listings.filter(
    (l) =>
      Math.abs(l.latitude - meanLat) <= 2 * (stdLat || 1) &&
      Math.abs(l.longitude - meanLng) <= 2 * (stdLng || 1)
  );

  const pool = filtered.length > 0 ? filtered : listings;
  return [
    [Math.min(...pool.map((l) => l.longitude)), Math.min(...pool.map((l) => l.latitude))],
    [Math.max(...pool.map((l) => l.longitude)), Math.max(...pool.map((l) => l.latitude))],
  ];
}

export default function HeroMapPreview({ listings = [], searchLocation = null }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [showExplore, setShowExplore] = useState(false);
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

    // Show explore button only on real user input (not programmatic flyTo)
    const onUserInput = () => setShowExplore(true);
    const container = mapContainerRef.current;
    container.addEventListener("mousedown", onUserInput, { once: true });
    container.addEventListener("touchstart", onUserInput, { once: true });
    container.addEventListener("wheel", onUserInput, { once: true });

    // Popup styles
    const style = document.createElement("style");
    style.textContent = `
      .hero-popup .mapboxgl-popup-content {
        padding: 0 !important;
        border-radius: 12px !important;
        box-shadow: 0 20px 40px rgba(0,0,0,0.15) !important;
        border: 1px solid rgba(226,232,240,0.8) !important;
        overflow: hidden !important;
        max-width: 220px !important;
      }
      .hero-popup .mapboxgl-popup-tip { border-top-color: #ffffff !important; }
      .hero-popup .mapboxgl-popup-close-button { display: none !important; }
    `;
    document.head.appendChild(style);
    map._heroPopupStyle = style;

    return () => {
      container.removeEventListener("mousedown", onUserInput);
      container.removeEventListener("touchstart", onUserInput);
      container.removeEventListener("wheel", onUserInput);
      if (map._heroPopupStyle) document.head.removeChild(map._heroPopupStyle);
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Add markers + center on cluster whenever listings arrive
  useEffect(() => {
    const map = mapRef.current;
    if (!map || listings.length === 0) return;

    const addMarkers = () => {
      if (map._heroMarkers) map._heroMarkers.forEach((m) => m.remove());
      map._heroMarkers = [];

      const valid = listings.filter((l) => l.longitude && l.latitude);

      valid.forEach((listing) => {
        const popup = new mapboxgl.Popup({
          offset: 25,
          closeButton: false,
          className: "hero-popup",
          maxWidth: "220px",
        }).setHTML(`
          <div data-listing-id="${listing._id}" style="width:220px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;border-radius:12px;overflow:hidden;cursor:pointer;">
            ${
              listing.images?.[0]
                ? `<img src="${listing.images[0]}" alt="" style="width:100%;height:110px;object-fit:cover;display:block;" />`
                : `<div style="width:100%;height:110px;background:#e5e7eb;"></div>`
            }
            <div style="padding:12px 14px 14px;">
              <div style="font-weight:700;font-size:16px;color:#111;line-height:1.2;">
                ${getRentRangeLabel(listing.unitTypes) || "N/A"}
                <span style="font-size:11px;font-weight:400;color:#9ca3af;"> /mo</span>
              </div>
              <div style="font-size:12px;color:#6b7280;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${listing.address || ""}
              </div>
            </div>
          </div>
        `);

        const starRating = Math.min(Math.max(Math.round(listing.rating || 5), 1), 5);
        const markerEl = document.createElement("div");
        markerEl.style.cssText = "width:36px;height:44px;cursor:pointer;";
        const markerImg = document.createElement("img");
        markerImg.src = `/assets/map-icons/map-${starRating}.svg`;
        markerImg.style.cssText = "width:100%;height:100%;";
        markerEl.appendChild(markerImg);

        const marker = new mapboxgl.Marker({ element: markerEl })
          .setLngLat([listing.longitude, listing.latitude])
          .setPopup(popup)
          .addTo(map);
        marker._listing = listing;

        popup.on("open", () => {
          markerImg.src = `/assets/map-icons/map-${starRating}-a.svg`;
          const el = popup.getElement()?.querySelector(`[data-listing-id="${listing._id}"]`);
          if (el) el.onclick = () => router.push(`/browse?listing=${listing._id}`);
        });
        popup.on("close", () => { markerImg.src = `/assets/map-icons/map-${starRating}.svg`; });

        map._heroMarkers.push(marker);
      });

      // Zoom out from campus center to frame the majority of listings
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
        const camera = map.cameraForBounds(symBounds, { padding: 80, maxZoom: 15 });
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
      if (map._searchMarker) { map._searchMarker.remove(); map._searchMarker = null; }

      const { lat, lng } = searchLocation;
      const match = map._heroMarkers?.find((m) => {
        const l = m._listing;
        return l?.latitude && l?.longitude && haversineMeters(lat, lng, l.latitude, l.longitude) <= 80;
      });

      if (match) {
        map.flyTo({ center: [lng, lat], zoom: 16, duration: 900 });
        setTimeout(() => match.togglePopup(), 950);
      } else {
        map.flyTo({ center: [lng, lat], zoom: 14, duration: 900 });
        const el = document.createElement("div");
        el.style.cssText = "width:14px;height:14px;background:#1a1a1a;border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:default;";
        map._searchMarker = new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      }
    };

    if (map.isStyleLoaded()) process();
    else map.once("load", process);
  }, [searchLocation]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={mapContainerRef}
        className="w-full h-full"
        style={{  }}
      />
      <div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 transition-all duration-300"
        style={{
          opacity: showExplore ? 1 : 0,
          transform: `translateX(-50%) translateY(${showExplore ? "0" : "12px"})`,
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
