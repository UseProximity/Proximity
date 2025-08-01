"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// WashU block bounds
const lngMin = -90.305,
  lngMax = -90.301;
const latMin = 38.6487,
  latMax = 38.6501;

// Generate a grid of points for the heatmap
const mockHeatmapPoints = [];
for (let lng = lngMin; lng < lngMax; lng += 0.00035) {
  for (let lat = latMin; lat < latMax; lat += 0.00025) {
    let weight = 0.2;
    const centerLng = -90.3035,
      centerLat = 38.6496;
    const d = Math.sqrt(
      Math.pow((lng - centerLng) * 1000, 2) +
        Math.pow((lat - centerLat) * 1000, 2)
    );
    if (d < 40) weight = 1;
    else if (d < 85) weight = 0.8;
    else if (d < 130) weight = 0.5;
    mockHeatmapPoints.push({ lng, lat, weight });
  }
}

export default function MapView({
  listings = [],
  filters,
  setFilters,
  handleReset,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [showHeatmap, setShowHeatmap] = useState(false);

  // Add custom CSS for popup styling
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      .custom-popup .mapboxgl-popup-content {
        padding: 0 !important;
        border-radius: 16px !important;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
        border: 1px solid rgba(226, 232, 240, 0.8) !important;
        background: transparent !important;
      }
      .custom-popup .mapboxgl-popup-tip {
        border-top-color: #ffffff !important;
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const heatmapData = useMemo(
    () => ({
      type: "FeatureCollection",
      features: mockHeatmapPoints.map((pt) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [pt.lng, pt.lat],
        },
        properties: {
          weight: pt.weight,
        },
      })),
    }),
    []
  );

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v11",
        center: [-90.3035, 38.6495],
        zoom: 15.5, // Adjusted for optimal WashU view
      });
      mapRef.current.addControl(new mapboxgl.NavigationControl());
    }
    const map = mapRef.current;

    if (map.markers) {
      map.markers.forEach((marker) => marker.remove());
    }
    map.markers = [];

    listings.forEach((listing) => {
      if (!listing.longitude || !listing.latitude) return;
      const marker = new mapboxgl.Marker({ color: "#ef4444" })
        .setLngLat([listing.longitude, listing.latitude])
        .setPopup(
          new mapboxgl.Popup({
            offset: 25,
            closeButton: true,
            className: "custom-popup",
          }).setHTML(`
            <div style="
              width: 260px; 
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
              border-radius: 16px;
              overflow: hidden;
              box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
              border: 1px solid rgba(226, 232, 240, 0.8);
              cursor: pointer;
            " onclick="window.location.href='/browse/${encodeURIComponent(
              listing._id
            )}'">
              <div style="position: relative; overflow: hidden;">
                <img src="${listing.images[0]}" alt="Property image"
                  style="
                    width: 100%; 
                    height: 130px; 
                    object-fit: cover;
                  " />
                <div style="
                  position: absolute;
                  bottom: 0;
                  left: 0;
                  right: 0;
                  height: 4px;
                  background: linear-gradient(90deg, #ef4444 0%, #f97316 50%, #ec4899 100%);
                "></div>
              </div>
              <div style="padding: 14px;">
                <div style="
                  font-weight: 700; 
                  font-size: 22px; 
                  color: #111827;
                  margin-bottom: 10px;
                  line-height: 1.2;
                ">
                  $${listing.rent.toLocaleString()}
                  <span style="font-size: 13px; font-weight: 400; color: #6b7280;">/month</span>
                </div>
                <div style="
                  display: flex; 
                  gap: 6px; 
                  margin-bottom: 10px;
                  flex-wrap: wrap;
                ">
                  <span style="
                    background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
                    border: 1px solid #a7f3d0;
                    color: #047857;
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 600;
                    display: inline-flex;
                    align-items: center;
                    gap: 2px;
                  ">
                    ${
                      listing.bedrooms
                    } <span style="font-weight: 400;">bd</span>
                  </span>
                  <span style="
                    background: linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%);
                    border: 1px solid #f9a8d4;
                    color: #be185d;
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 600;
                    display: inline-flex;
                    align-items: center;
                    gap: 2px;
                  ">
                    ${
                      listing.bathrooms
                    } <span style="font-weight: 400;">ba</span>
                  </span>
                  <span style="
                    background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
                    border: 1px solid #fcd34d;
                    color: #d97706;
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 600;
                    display: inline-flex;
                    align-items: center;
                    gap: 2px;
                  ">
                    ${listing.area} <span style="font-weight: 400;">sqft</span>
                  </span>
                </div>
                <div style="
                  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                  border: 1px solid #e2e8f0;
                  border-radius: 12px;
                  padding: 10px;
                  display: flex;
                  align-items: flex-start;
                  gap: 8px;
                ">
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="#6366f1" style="margin-top: 2px; flex-shrink: 0;">
                    <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
                  </svg>
                  <div style="
                    font-size: 12px; 
                    color: #374151; 
                    line-height: 1.4;
                    font-weight: 500;
                  ">${listing.address}</div>
                </div>
              </div>
            </div>
          `)
        )
        .addTo(map);
      map.markers.push(marker);
    });

    const addHeatmap = () => {
      if (!map.getSource("houses-heatmap")) {
        map.addSource("houses-heatmap", {
          type: "geojson",
          data: heatmapData,
        });
      } else {
        map.getSource("houses-heatmap").setData(heatmapData);
      }

      if (!map.getLayer("houses-heatmap-layer")) {
        map.addLayer(
          {
            id: "houses-heatmap-layer",
            type: "heatmap",
            source: "houses-heatmap",
            paint: {
              "heatmap-weight": ["get", "weight"],
              "heatmap-intensity": 2.5,
              "heatmap-radius": 60,
              "heatmap-opacity": 0.7,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(0,255,0,0.6)",
                0.3,
                "rgba(255,255,0,0.7)",
                0.6,
                "rgba(255,140,0,0.8)",
                1,
                "rgba(255,0,0,0.9)",
              ],
            },
          },
          map.getStyle().layers.find((l) => l.type === "symbol")?.id
        );
      }
    };

    const removeHeatmap = () => {
      if (map.getLayer("houses-heatmap-layer")) {
        map.removeLayer("houses-heatmap-layer");
      }
      if (map.getSource("houses-heatmap")) {
        map.removeSource("houses-heatmap");
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("style.load", () => {
        showHeatmap ? addHeatmap() : removeHeatmap();
      });
    } else {
      showHeatmap ? addHeatmap() : removeHeatmap();
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [listings, showHeatmap, heatmapData]);

  return (
    <div className="relative w-full h-full">
      {/* Filter Controls Row */}
      <div className="absolute z-10 top-4 left-4 right-4 flex items-center justify-start">
        <div className="flex gap-2">
          <button
            className="bg-white px-4 py-2 rounded-lg shadow-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            onClick={() => setShowHeatmap((v) => !v)}
          >
            {showHeatmap ? "Hide Heatmap" : "Show Heatmap"}
          </button>
        </div>
      </div>

      {showHeatmap && (
        <div
          className="absolute z-10 top-20 left-4 bg-white px-4 py-3 rounded-lg shadow-lg border border-gray-200 text-sm flex flex-col gap-2"
          style={{ minWidth: 160 }}
        >
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-3 bg-red-600 rounded-sm"></span>
            Most Dense
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-3 bg-orange-600 rounded-sm"></span>
            Dense
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-3 bg-yellow-400 rounded-sm"></span>
            Moderate
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-3 bg-green-500 rounded-sm"></span>
            Open
          </div>
        </div>
      )}

      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
}
