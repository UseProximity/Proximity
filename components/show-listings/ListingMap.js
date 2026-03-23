"use client";

import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";

export default function ListingMap({ latitude, longitude, address }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!latitude || !longitude) return;
    if (mapRef.current) return; // already initialized

    const initMap = async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [longitude, latitude],
        zoom: 15,
      });

      new mapboxgl.Marker({ color: "#dc2626" })
        .setLngLat([longitude, latitude])
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setText(address || "Listing"))
        .addTo(map);

      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      mapRef.current = map;
    };

    initMap();

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude, address]);

  if (!latitude || !longitude) {
    return (
      <div className="w-full h-[400px] rounded-xl bg-gray-100 flex items-center justify-center text-gray-500">
        Location not available for this listing.
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-[400px] rounded-xl overflow-hidden" />;
}
