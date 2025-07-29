"use client";

import { useEffect, useRef, useState } from "react";
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

export default function MapView({ listings = [] }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [showHeatmap, setShowHeatmap] = useState(false);

  const heatmapData = {
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
  };

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
      const marker = new mapboxgl.Marker()
        .setLngLat([listing.longitude, listing.latitude])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <a href="/browse/${encodeURIComponent(
              listing._id
            )}" style="text-decoration: none; color: inherit;">
              <div style="width: 240px; font-family: sans-serif;">
                <img src="${listing.images[0]}" alt="House image"
                  style="width: 100%; height: 120px; object-fit: cover; border-radius: 8px;" />
                <div style="padding: 8px;">
                  <div style="font-weight: bold; font-size: 18px; color: #111;">$${
                    listing.rent
                  }</div>
                  <div style="font-size: 14px; color: #666;">${
                    listing.bedrooms
                  } bds • ${listing.bathrooms} ba • ${listing.area} sqft</div>
                  <div style="font-size: 13px; margin-top: 4px;">${
                    listing.address
                  }</div>
                </div>
              </div>
            </a>
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
  }, [listings, showHeatmap]);

  return (
    <div className="relative w-full h-full">
      <button
        className="absolute z-10 top-4 left-4 bg-white px-4 py-2 rounded shadow"
        onClick={() => setShowHeatmap((v) => !v)}
      >
        {showHeatmap ? "Hide Heatmap" : "Show Heatmap"}
      </button>

      {showHeatmap && (
        <div
          className="absolute z-10 top-20 left-4 bg-white px-4 py-2 rounded shadow text-sm flex flex-col gap-1"
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
