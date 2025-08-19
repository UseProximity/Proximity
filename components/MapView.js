"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// WashU area bounds (expanded for more coverage)
const lngMin = -90.31,
  lngMax = -90.295;
const latMin = 38.645,
  latMax = 38.655;

// WashU Campus center coordinates (Danforth Campus)
const WASHU_CAMPUS_CENTER = {
  longitude: -90.3053,
  latitude: 38.6489,
};

// Function to fetch crime data from CrimeoMeter API
const fetchCrimeData = async (lat, lng, range = 1) => {
  try {
    /*console.log(
      `🌐 Fetching crime data for coordinates: ${lat}, ${lng} with range: ${range}km`
    );*/

    const url = `https://crimeometer.p.rapidapi.com/raw-data?lat=${lat}&lng=${lng}&range=${range}`;
    //console.log(`🔗 API URL: ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": process.env.NEXT_PUBLIC_RAPIDAPI_KEY,
        "X-RapidAPI-Host": "crimeometer.p.rapidapi.com",
      },
    });

    //console.log(`📡 Response status: ${response.status}`);

    if (!response.ok) {
      //console.error(`❌ HTTP error! status: ${response.status}`);
      const errorText = await response.text();
      //console.error(`❌ Error response body: ${errorText}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    //console.log("📊 Crime data received:", data);
    /*console.log(
      "📈 Number of records:",
      data.crimes?.length || data.incidents?.length || 0
    );*/
    return data;
  } catch (error) {
    //console.error("💥 Error fetching crime data:", error);
    return null;
  }
};

// Function to process crime data into heatmap format
const processCrimeDataForHeatmap = (crimeData) => {
  if (!crimeData || !crimeData.crimes) {
    return [];
  }

  return crimeData.crimes
    .map((crime) => ({
      lng: crime.position?.longitude || crime.lng,
      lat: crime.position?.latitude || crime.lat,
      weight: 0.8, // You can adjust weight based on crime type/severity
      type: crime.type,
      date: crime.date,
    }))
    .filter((point) => point.lng && point.lat);
};

// Generate random scattered points for the heatmap
const mockHeatmapPoints = [];

// Generate mock crime data points for testing - much more spread out like housing data
const generateMockCrimeData = () => {
  const crimePoints = [];

  // Generate different density clusters randomly spread across the entire area
  const crimeClusterTypes = [
    // High intensity clusters (dark red areas)
    { count: 12, weight: 1.0, spread: 0.002 },
    { count: 10, weight: 0.9, spread: 0.0025 },
    { count: 8, weight: 0.85, spread: 0.003 },

    // Medium intensity clusters (orange/red areas)
    { count: 15, weight: 0.7, spread: 0.004 },
    { count: 12, weight: 0.6, spread: 0.005 },
    { count: 10, weight: 0.5, spread: 0.006 },

    // Low intensity scattered points (yellow areas)
    { count: 20, weight: 0.4, spread: 0.007 },
    { count: 18, weight: 0.3, spread: 0.008 },
    { count: 25, weight: 0.2, spread: 0.009 },
    { count: 30, weight: 0.1, spread: 0.01 },
  ];

  crimeClusterTypes.forEach((cluster) => {
    for (let i = 0; i < cluster.count; i++) {
      // Random center point for this cluster across the entire area
      const centerLng = lngMin + Math.random() * (lngMax - lngMin);
      const centerLat = latMin + Math.random() * (latMax - latMin);

      // Generate multiple points around this center
      const pointsInCluster = Math.floor(Math.random() * 6) + 3; // 3-8 points per cluster

      for (let j = 0; j < pointsInCluster; j++) {
        const lng = centerLng + (Math.random() - 0.5) * cluster.spread;
        const lat = centerLat + (Math.random() - 0.5) * cluster.spread;

        // Keep points within bounds
        if (lng >= lngMin && lng <= lngMax && lat >= latMin && lat <= latMax) {
          crimePoints.push({
            lng,
            lat,
            weight: cluster.weight * (0.8 + Math.random() * 0.4), // Add weight variation
            type: [
              "theft",
              "vandalism",
              "assault",
              "burglary",
              "robbery",
              "disturbance",
            ][Math.floor(Math.random() * 6)],
            date: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
            ).toISOString(),
          });
        }
      }
    }
  });

  // Add completely random scattered crime points across the entire area
  for (let i = 0; i < 80; i++) {
    crimePoints.push({
      lng: lngMin + Math.random() * (lngMax - lngMin),
      lat: latMin + Math.random() * (latMax - latMin),
      weight: Math.random() * 0.6, // Random weights from 0 to 0.6
      type: ["theft", "vandalism", "minor incident", "noise complaint"][
        Math.floor(Math.random() * 4)
      ],
      date: new Date(
        Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000
      ).toISOString(),
    });
  }

  return crimePoints;
};

const mockCrimeData = generateMockCrimeData();

// Create a more random distribution
const generateRandomHeatmapPoints = () => {
  const points = [];

  // Generate different density clusters randomly spread across the area
  const clusters = [
    // High intensity clusters (red areas)
    { count: 15, weight: 1.0, spread: 0.001 },
    { count: 12, weight: 0.9, spread: 0.0012 },
    { count: 10, weight: 0.85, spread: 0.0015 },

    // Medium intensity clusters (orange/yellow areas)
    { count: 20, weight: 0.6, spread: 0.002 },
    { count: 18, weight: 0.5, spread: 0.0025 },
    { count: 15, weight: 0.4, spread: 0.003 },

    // Low intensity scattered points (green areas)
    { count: 30, weight: 0.3, spread: 0.004 },
    { count: 25, weight: 0.2, spread: 0.005 },
    { count: 40, weight: 0.1, spread: 0.006 },
  ];

  clusters.forEach((cluster) => {
    for (let i = 0; i < cluster.count; i++) {
      // Random center point for this cluster
      const centerLng = lngMin + Math.random() * (lngMax - lngMin);
      const centerLat = latMin + Math.random() * (latMax - latMin);

      // Generate points around this center with some randomness
      const pointsInCluster = Math.floor(Math.random() * 8) + 3; // 3-10 points per cluster

      for (let j = 0; j < pointsInCluster; j++) {
        const lng = centerLng + (Math.random() - 0.5) * cluster.spread;
        const lat = centerLat + (Math.random() - 0.5) * cluster.spread;

        // Keep points within bounds
        if (lng >= lngMin && lng <= lngMax && lat >= latMin && lat <= latMax) {
          points.push({
            lng,
            lat,
            weight: cluster.weight * (0.7 + Math.random() * 0.6), // Add some weight variation
          });
        }
      }
    }
  });

  // Add some completely random scattered points
  for (let i = 0; i < 50; i++) {
    points.push({
      lng: lngMin + Math.random() * (lngMax - lngMin),
      lat: latMin + Math.random() * (latMax - latMin),
      weight: Math.random() * 0.8, // Random weights from 0 to 0.8
    });
  }

  return points;
};

mockHeatmapPoints.push(...generateRandomHeatmapPoints());

export default function MapView({
  listings = [],
  filters,
  setFilters,
  handleReset,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showCrimeMap, setShowCrimeMap] = useState(false);
  const [activeRouteId, setActiveRouteId] = useState(null);
  const [crimeData, setCrimeData] = useState(mockCrimeData); // Initialize with mock data
  const [loading, setLoading] = useState(false);
  const [isRealCrimeData, setIsRealCrimeData] = useState(false);

  // Function to load crime data for the area
  const loadCrimeData = useCallback(async () => {
    setLoading(true);
    try {
      /*
      console.log(
        "Attempting to fetch real crime data from Crimeometer API..."
      );*/
      // Fetch crime data for WashU campus area
      /*
      const data = await fetchCrimeData(
        WASHU_CAMPUS_CENTER.latitude,
        WASHU_CAMPUS_CENTER.longitude,
        2
      );*/
      const data = null; // Simulate API call for now

      //console.log("API Response:", data);

      if (data && data.crimes && data.crimes.length > 0) {
        //console.log("✅ Using REAL crime data from API");
        const processedData = processCrimeDataForHeatmap(data);
        setCrimeData(processedData);
        setIsRealCrimeData(true);
      } else if (data && data.incidents && data.incidents.length > 0) {
        // Try alternative data structure
        //console.log("✅ Using REAL crime data from API (incidents format)");
        const processedData = data.incidents
          .map((incident) => ({
            lng: incident.longitude || incident.lng,
            lat: incident.latitude || incident.lat,
            weight: 0.8,
            type: incident.type || incident.offense_type,
            date: incident.date || incident.incident_date,
          }))
          .filter((point) => point.lng && point.lat);
        setCrimeData(processedData);
        setIsRealCrimeData(true);
      } else {
        // Use mock data if API fails or returns no data
        /*console.log(
          "⚠️ API returned no data, using MOCK crime data for demonstration"
        );*/
        setCrimeData(mockCrimeData);
        setIsRealCrimeData(false);
      }
    } catch (error) {
      //console.error("❌ Error loading crime data from API:", error);
      // Use mock data as fallback
      //console.log("⚠️ Using MOCK crime data as fallback due to API error");
      setCrimeData(mockCrimeData);
      setIsRealCrimeData(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load crime data when component mounts
  useEffect(() => {
    loadCrimeData();
  }, [loadCrimeData]);

  // Load crime data when crime map is toggled on
  useEffect(() => {
    if (showCrimeMap) {
      loadCrimeData();
    }
  }, [showCrimeMap, loadCrimeData]);

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

  // Add custom CSS for popup styling
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      .custom-popup .mapboxgl-popup-content {
        padding: 0 !important;
        border-radius: 12px !important;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
        border: 1px solid rgba(226, 232, 240, 0.8) !important;
        background: #ffffff !important;
        max-width: 280px !important;
        overflow: hidden !important;
      }
      .custom-popup .mapboxgl-popup-tip {
        border-top-color: #ffffff !important;
      }
      .custom-popup .mapboxgl-popup-close-button {
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(255, 255, 255, 0.9);
        color: #374151;
        border: none;
        border-radius: 50%;
        width: 28px;
        height: 28px;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.5);
      }
      .custom-popup .mapboxgl-popup-close-button:hover {
        background: rgba(255, 255, 255, 1);
        box-shadow: 0 8px 15px -3px rgba(0, 0, 0, 0.1);
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

  const crimeHeatmapData = useMemo(
    () => ({
      type: "FeatureCollection",
      features: crimeData.map((pt) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [pt.lng, pt.lat],
        },
        properties: {
          weight: pt.weight || 0.5,
          type: pt.type,
          date: pt.date,
        },
      })),
    }),
    [crimeData]
  );

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Make functions available globally for popup buttons
    window.showRouteToCampus = showRouteToCampus;
    window.hideRoute = hideRoute;

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

      // Calculate distance to campus
      const distanceToCampus = calculateDistance(
        listing.latitude,
        listing.longitude,
        WASHU_CAMPUS_CENTER.latitude,
        WASHU_CAMPUS_CENTER.longitude
      ).toFixed(1);

      const marker = new mapboxgl.Marker({ color: "#ef4444" })
        .setLngLat([listing.longitude, listing.latitude])
        .setPopup(
          new mapboxgl.Popup({
            offset: 25,
            closeButton: true,
            className: "custom-popup",
            maxWidth: "240px",
          }).setHTML(`
            <div style="
              width: 240px; 
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #ffffff;
              border-radius: 12px;
              overflow: hidden;
              cursor: pointer;
              position: relative;
            " onclick="window.location.href='/browse/${encodeURIComponent(
              listing._id
            )}'">
              <div style="position: relative; overflow: hidden;">
                <img src="${
                  listing.images?.[0] || "/images/default-property.jpg"
                }" alt="Property image"
                  style="
                    width: 100%; 
                    height: 140px; 
                    object-fit: cover;
                  " />
                <div style="
                  position: absolute;
                  top: 8px;
                  left: 8px;
                  background: rgba(0, 0, 0, 0.7);
                  color: white;
                  padding: 4px 8px;
                  border-radius: 12px;
                  font-size: 11px;
                  font-weight: 600;
                ">
                  ${distanceToCampus} mi to campus
                </div>
                <div style="
                  position: absolute;
                  inset: 0;
                  background: linear-gradient(to top, rgba(0,0,0,0.2) 0%, transparent 100%);
                  opacity: 0;
                  transition: opacity 0.3s ease;
                " onmouseover="this.style.opacity = '1'" onmouseout="this.style.opacity = '0'"></div>
              </div>
              
              <div style="padding: 16px; background: linear-gradient(135deg, rgba(249,250,251,0.5) 0%, #ffffff 100%);">
                <div style="
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  margin-bottom: 12px;
                ">
                  <h3 style="
                    font-weight: 700; 
                    font-size: 20px; 
                    color: #000000;
                    margin: 0;
                    line-height: 1.2;
                  ">
                    $${listing.rent?.toLocaleString() || "N/A"}
                    <span style="font-size: 12px; font-weight: 400;">/month</span>
                  </h3>
                </div>
                
                <div style="
                  display: flex; 
                  align-items: center;
                  gap: 8px; 
                  margin-bottom: 12px;
                ">
                  <div style="
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    background: linear-gradient(to right, #ecfdf5 0%, #fef2f2 100%);
                    border: 1px solid #a7f3d0;
                    padding: 4px 8px;
                    border-radius: 20px;
                    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                  ">
                    <span style="color: #047857; font-weight: 600; font-size: 12px;">${
                      listing.bedrooms || 0
                    }</span>
                    <span style="color: #059669; font-size: 10px;">bd</span>
                  </div>
                  
                  <div style="
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    background: linear-gradient(to right, #fdf2f8 0%, #fce7f3 100%);
                    border: 1px solid #f9a8d4;
                    padding: 4px 8px;
                    border-radius: 20px;
                    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                  ">
                    <span style="color: #be185d; font-weight: 600; font-size: 12px;">${
                      listing.bathrooms || 0
                    }</span>
                    <span style="color: #db2777; font-size: 10px;">ba</span>
                  </div>
                  
                  <div style="
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    background: linear-gradient(to right, #fffbeb 0%, #fef3c7 100%);
                    border: 1px solid #fcd34d;
                    padding: 4px 8px;
                    border-radius: 20px;
                    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                  ">
                    <span style="color: #d97706; font-weight: 600; font-size: 12px;">${
                      listing.area || 0
                    }</span>
                    <span style="color: #f59e0b; font-size: 10px;">sqft</span>
                  </div>
                </div>
                
                <div style="
                  display: flex;
                  align-items: flex-start;
                  gap: 6px;
                  background: #f9fafb;
                  border-radius: 8px;
                  padding: 10px;
                  border: 1px solid #f3f4f6;
                  margin-bottom: 12px;
                ">
                  <svg style="
                    width: 14px;
                    height: 14px;
                    color: #6366f1;
                    margin-top: 2px;
                    flex-shrink: 0;
                  " fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
                  </svg>
                  <p style="
                    font-size: 12px;
                    color: #374151;
                    line-height: 1.4;
                    font-weight: 500;
                    margin: 0;
                  ">${listing.address || "Address not available"}</p>
                </div>
                
                <button 
                  id="route-btn-${listing._id}"
                  onclick="event.stopPropagation(); 
                    const isActive = this.getAttribute('data-active') === 'true';
                    if (isActive) {
                      window.hideRoute && window.hideRoute();
                      this.style.background = 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)';
                      this.style.color = '#374151';
                      this.innerHTML = '📍 Show Route to Campus';
                      this.setAttribute('data-active', 'false');
                    } else {
                      window.showRouteToCampus && window.showRouteToCampus([${
                        listing.longitude
                      }, ${listing.latitude}], '${listing._id}');
                      this.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                      this.style.color = 'white';
                      this.innerHTML = 'Hide Route';
                      this.setAttribute('data-active', 'true');
                    }"
                  data-active="false"
                  style="
                    width: 100%;
                    padding: 10px 12px;
                    background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
                    color: #374151;
                    border: none;
                    border-radius: 8px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                  "
                  onmouseover="if(this.getAttribute('data-active') === 'false') { this.style.background = 'linear-gradient(135deg, #e5e7eb 0%, #d1d5db 100%)'; }"
                  onmouseout="if(this.getAttribute('data-active') === 'false') { this.style.background = 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)'; }"
                >
                  📍 Show Route to Campus
                </button>
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
              "heatmap-intensity": {
                stops: [
                  [11, 1],
                  [15, 3],
                  [18, 5],
                ],
              },
              "heatmap-radius": {
                stops: [
                  [11, 15],
                  [15, 30],
                  [18, 50],
                ],
              },
              "heatmap-opacity": 0.8,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(0,255,0,0.3)", // Transparent green (lowest density)
                0.15,
                "rgba(50,255,50,0.5)", // Light green
                0.25,
                "rgba(100,255,100,0.6)", // Medium green
                0.35,
                "rgba(200,255,0,0.7)", // Yellow-green
                0.5,
                "rgba(255,255,0,0.75)", // Yellow
                0.65,
                "rgba(255,200,0,0.8)", // Orange-yellow
                0.75,
                "rgba(255,165,0,0.85)", // Orange
                0.85,
                "rgba(255,100,0,0.9)", // Red-orange
                0.95,
                "rgba(255,50,0,0.95)", // Bright red
                1,
                "rgba(200,0,0,1)", // Dark red (highest density)
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

    const addCrimeHeatmap = () => {
      if (!map.getSource("crime-heatmap")) {
        map.addSource("crime-heatmap", {
          type: "geojson",
          data: crimeHeatmapData,
        });
      } else {
        map.getSource("crime-heatmap").setData(crimeHeatmapData);
      }

      if (!map.getLayer("crime-heatmap-layer")) {
        map.addLayer(
          {
            id: "crime-heatmap-layer",
            type: "heatmap",
            source: "crime-heatmap",
            paint: {
              "heatmap-weight": ["get", "weight"],
              "heatmap-intensity": {
                stops: [
                  [11, 1.5],
                  [15, 3],
                  [18, 5],
                ],
              },
              "heatmap-radius": {
                stops: [
                  [11, 25],
                  [15, 45],
                  [18, 80],
                ],
              },
              "heatmap-opacity": 0.8,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(255,255,255,0)", // Transparent
                0.05,
                "rgba(255,255,200,0.2)", // Very light yellow
                0.15,
                "rgba(255,255,0,0.3)", // Light yellow
                0.25,
                "rgba(255,220,0,0.4)", // Yellow
                0.4,
                "rgba(255,180,0,0.5)", // Orange-yellow
                0.55,
                "rgba(255,165,0,0.6)", // Orange
                0.7,
                "rgba(255,100,0,0.75)", // Red-orange
                0.8,
                "rgba(255,69,0,0.85)", // Bright red-orange
                0.9,
                "rgba(255,0,0,0.9)", // Red
                1,
                "rgba(139,0,0,0.95)", // Dark red
              ],
            },
          },
          map.getStyle().layers.find((l) => l.type === "symbol")?.id
        );
      }
    };

    const removeCrimeHeatmap = () => {
      if (map.getLayer("crime-heatmap-layer")) {
        map.removeLayer("crime-heatmap-layer");
      }
      if (map.getSource("crime-heatmap")) {
        map.removeSource("crime-heatmap");
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("style.load", () => {
        showHeatmap ? addHeatmap() : removeHeatmap();
        showCrimeMap ? addCrimeHeatmap() : removeCrimeHeatmap();
      });
    } else {
      showHeatmap ? addHeatmap() : removeHeatmap();
      showCrimeMap ? addCrimeHeatmap() : removeCrimeHeatmap();
    }

    return () => {
      // Cleanup global functions
      delete window.showRouteToCampus;
      delete window.hideRoute;

      map.remove();
      mapRef.current = null;
    };
  }, [
    listings,
    showHeatmap,
    showCrimeMap,
    heatmapData,
    crimeHeatmapData,
    showRouteToCampus,
    hideRoute,
  ]);
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
          <button
            className="bg-white px-4 py-2 rounded-lg shadow-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            onClick={() => setShowCrimeMap((v) => !v)}
            disabled={loading}
          >
            {loading
              ? "Loading..."
              : showCrimeMap
              ? "Hide Crime Map"
              : "Show Crime Map"}
          </button>
        </div>
      </div>

      {showHeatmap && (
        <div
          className="absolute z-10 top-20 left-4 bg-white px-4 py-3 rounded-lg shadow-lg border border-gray-200 text-sm flex flex-col gap-2"
          style={{ minWidth: 160 }}
        >
          <div className="font-semibold text-gray-800 mb-1">
            Housing Density
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-3 bg-red-800 rounded-sm"></span>
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

      {showCrimeMap && (
        <div
          className="absolute z-10 left-4 bg-white px-4 py-3 rounded-lg shadow-lg border border-gray-200 text-sm flex flex-col gap-2"
          style={{
            minWidth: 160,
            top: showHeatmap ? "280px" : "80px",
          }}
        >
          <div className="font-semibold text-gray-800 mb-1">Crime Density</div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-3 bg-red-900 rounded-sm"></span>
            Very High
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-3 bg-red-600 rounded-sm"></span>
            High
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-3 bg-orange-500 rounded-sm"></span>
            Medium
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-3 bg-yellow-400 rounded-sm"></span>
            Low
          </div>
        </div>
      )}

      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
}
