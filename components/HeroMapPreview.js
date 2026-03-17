"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useRouter } from "next/navigation";
import { getRentRangeLabel } from "@/utils/listingFormatters";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Euclidean distance between two listings (degrees — fine for relative comparison)
function distBetween(a, b) {
  const dlng = a.longitude - b.longitude;
  const dlat = a.latitude - b.latitude;
  return Math.sqrt(dlng * dlng + dlat * dlat);
}

// Find up to 3 listings that form the tightest cluster, return their centroid
function findClusterCenter(listings) {
  const valid = listings.filter((l) => l.longitude && l.latitude);
  if (valid.length === 0) return null;
  if (valid.length === 1) return { lng: valid[0].longitude, lat: valid[0].latitude };

  // Find the closest pair
  let minDist = Infinity;
  let pairIdx = [0, 1];
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const d = distBetween(valid[i], valid[j]);
      if (d < minDist) {
        minDist = d;
        pairIdx = [i, j];
      }
    }
  }

  const a = valid[pairIdx[0]];
  const b = valid[pairIdx[1]];
  const midLng = (a.longitude + b.longitude) / 2;
  const midLat = (a.latitude + b.latitude) / 2;

  // Find the listing closest to the pair's midpoint (excluding the pair itself)
  let thirdIdx = -1;
  let minDistToMid = Infinity;
  for (let i = 0; i < valid.length; i++) {
    if (i === pairIdx[0] || i === pairIdx[1]) continue;
    const dlng = valid[i].longitude - midLng;
    const dlat = valid[i].latitude - midLat;
    const d = Math.sqrt(dlng * dlng + dlat * dlat);
    if (d < minDistToMid) {
      minDistToMid = d;
      thirdIdx = i;
    }
  }

  const cluster = [a, b];
  if (thirdIdx >= 0) cluster.push(valid[thirdIdx]);

  return {
    lng: cluster.reduce((s, l) => s + l.longitude, 0) / cluster.length,
    lat: cluster.reduce((s, l) => s + l.latitude, 0) / cluster.length,
  };
}

export default function HeroMapPreview({ listings = [] }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const autoOpenedRef = useRef(false);
  const [showExplore, setShowExplore] = useState(false);
  const router = useRouter();

  // Init map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const isMobileDevice = window.innerWidth < 768;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [-90.3032, 38.6495],
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
          <div style="width:220px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;border-radius:12px;overflow:hidden;">
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

        const marker = new mapboxgl.Marker({ color: "#ef4444" })
          .setLngLat([listing.longitude, listing.latitude])
          .setPopup(popup)
          .addTo(map);

        map._heroMarkers.push(marker);
      });

      // Fly to cluster centroid
      const center = findClusterCenter(valid);
      if (center) {
        map.flyTo({ center: [center.lng, center.lat], zoom: 15.5, duration: 1200, essential: true });
      }

      // Auto-open a popup on a random cluster marker, only once
      if (!autoOpenedRef.current && map._heroMarkers.length > 0) {
        autoOpenedRef.current = true;
        const idx = Math.floor(Math.random() * map._heroMarkers.length);
        setTimeout(() => {
          map._heroMarkers[idx]?.togglePopup();
        }, 1400);
      }
    };

    if (map.isStyleLoaded()) {
      addMarkers();
    } else {
      map.once("load", addMarkers);
    }
  }, [listings]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={mapContainerRef}
        className="w-full h-full"
        style={{ filter: "saturate(0.45) brightness(1.04)" }}
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
