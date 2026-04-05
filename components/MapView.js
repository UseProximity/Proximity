"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useRouter } from "next/navigation";
import {
  getAreaRangeLabel,
  getRentRangeLabel,
  getUnitValuesLabel,
} from "@/utils/listingFormatters";

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

// // Generate random scattered points for the heatmap
// const mockHeatmapPoints = [];

// // Generate mock crime data points for testing - much more spread out like housing data
// const generateMockCrimeData = () => {
//   const crimePoints = [];

//   // Generate different density clusters randomly spread across the entire area
//   const crimeClusterTypes = [
//     // High intensity clusters (dark red areas)
//     { count: 12, weight: 1.0, spread: 0.002 },
//     { count: 10, weight: 0.9, spread: 0.0025 },
//     { count: 8, weight: 0.85, spread: 0.003 },

//     // Medium intensity clusters (orange/red areas)
//     { count: 15, weight: 0.7, spread: 0.004 },
//     { count: 12, weight: 0.6, spread: 0.005 },
//     { count: 10, weight: 0.5, spread: 0.006 },

//     // Low intensity scattered points (yellow areas)
//     { count: 20, weight: 0.4, spread: 0.007 },
//     { count: 18, weight: 0.3, spread: 0.008 },
//     { count: 25, weight: 0.2, spread: 0.009 },
//     { count: 30, weight: 0.1, spread: 0.01 },
//   ];

//   crimeClusterTypes.forEach((cluster) => {
//     for (let i = 0; i < cluster.count; i++) {
//       const centerLng = lngMin + Math.random() * (lngMax - lngMin);
//       const centerLat = latMin + Math.random() * (latMax - latMin);
//       const pointsInCluster = Math.floor(Math.random() * 6) + 3;

//       for (let j = 0; j < pointsInCluster; j++) {
//         const lng = centerLng + (Math.random() - 0.5) * cluster.spread;
//         const lat = centerLat + (Math.random() - 0.5) * cluster.spread;

//         if (lng >= lngMin && lng <= lngMax && lat >= latMin && lat <= latMax) {
//           crimePoints.push({
//             lng,
//             lat,
//             weight: cluster.weight * (0.8 + Math.random() * 0.4),
//             type: ["theft","vandalism","assault","burglary","robbery","disturbance"][Math.floor(Math.random() * 6)],
//             date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
//           });
//         }
//       }
//     }
//   });

//   for (let i = 0; i < 80; i++) {
//     crimePoints.push({
//       lng: lngMin + Math.random() * (lngMax - lngMin),
//       lat: latMin + Math.random() * (latMax - latMin),
//       weight: Math.random() * 0.6,
//       type: ["theft","vandalism","minor incident","noise complaint"][Math.floor(Math.random() * 4)],
//       date: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000).toISOString(),
//     });
//   }

//   return crimePoints;
// };

// const mockCrimeData = generateMockCrimeData();

// // Create a more random distribution
// const generateRandomHeatmapPoints = () => {
//   const points = [];

//   const clusters = [
//     { count: 15, weight: 1.0, spread: 0.001 },
//     { count: 12, weight: 0.9, spread: 0.0012 },
//     { count: 10, weight: 0.85, spread: 0.0015 },
//     { count: 20, weight: 0.6, spread: 0.002 },
//     { count: 18, weight: 0.5, spread: 0.0025 },
//     { count: 15, weight: 0.4, spread: 0.003 },
//     { count: 30, weight: 0.3, spread: 0.004 },
//     { count: 25, weight: 0.2, spread: 0.005 },
//     { count: 40, weight: 0.1, spread: 0.006 },
//   ];

//   clusters.forEach((cluster) => {
//     for (let i = 0; i < cluster.count; i++) {
//       const centerLng = lngMin + Math.random() * (lngMax - lngMin);
//       const centerLat = latMin + Math.random() * (latMax - latMin);
//       const pointsInCluster = Math.floor(Math.random() * 8) + 3;

//       for (let j = 0; j < pointsInCluster; j++) {
//         const lng = centerLng + (Math.random() - 0.5) * cluster.spread;
//         const lat = centerLat + (Math.random() - 0.5) * cluster.spread;

//         if (lng >= lngMin && lng <= lngMax && lat >= latMin && lat <= latMax) {
//           points.push({ lng, lat, weight: cluster.weight * (0.7 + Math.random() * 0.6) });
//         }
//       }
//     }
//   });

//   for (let i = 0; i < 50; i++) {
//     points.push({
//       lng: lngMin + Math.random() * (lngMax - lngMin),
//       lat: latMin + Math.random() * (latMax - latMin),
//       weight: Math.random() * 0.8,
//     });
//   }

//   return points;
// };

// mockHeatmapPoints.push(...generateRandomHeatmapPoints());

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

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function MapView({
  listings = [],
  filters,
  setFilters,
  handleReset,
  onListingSelect,
  selectedListingId,
  searchLocation = null,
  isActive = true,
  heroMode = false,
}) {
  const router = useRouter();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showExplore, setShowExplore] = useState(false);
  const [showCrimeMap, setShowCrimeMap] = useState(false);
  const [activeRouteId, setActiveRouteId] = useState(null);
  const [crimeData, setCrimeData] = useState([]);
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
      const data = await fetchCrimeData(
        WASHU_CAMPUS_CENTER.latitude,
        WASHU_CAMPUS_CENTER.longitude,
        2
      );

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
        setCrimeData([]);
        setIsRealCrimeData(false);
      }
    } catch (error) {
      //console.error("❌ Error loading crime data from API:", error);
      setCrimeData([]);
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


  const heatmapData = useMemo(
    () => ({
      type: "FeatureCollection",
      features: listings
        .filter((l) => l.longitude && l.latitude)
        .map((l) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [l.longitude, l.latitude],
          },
          properties: {
            weight: 1.0,
          },
        })),
    }),
    [listings]
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
    const sortedListings = [...listings].sort((a, b) => b.latitude - a.latitude);

    sortedListings.forEach((listing) => {
      if (!listing.longitude || !listing.latitude) return;

      const starRating = Math.min(Math.max(Math.round(listing.rating || 5), 1), 5);
      const markerEl = document.createElement("div");
      markerEl.style.cssText = "width:36px;height:44px;cursor:pointer;";
      const markerImg = document.createElement("img");
      markerImg.src = `/assets/map-icons/map-${starRating}.svg`;
      markerImg.style.cssText = "width:100%;height:100%;";
      markerEl.appendChild(markerImg);
      const marker = new mapboxgl.Marker({ element: markerEl })
        .setLngLat([listing.longitude, listing.latitude])
        .addTo(map);
      marker._listingId = listing._id;
      marker._starRating = starRating;
      if (onListingSelect) {
        markerEl.addEventListener("click", () => {
          onListingSelect(listing);
        });
      } else {
        markerEl.style.cursor = "default";
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
          const camera = map.cameraForBounds(symBounds, { padding: 80, maxZoom: 15 });
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
      // Cleanup only markers added by this effect. Do NOT remove the map instance here
      if (map.markers) {
        map.markers.forEach((marker) => marker.remove());
        map.markers = [];
      }
      // Keep global helpers and the map alive; map removal is handled by the mount/unmount effect
    };
  }, [isActive, listings, showHeatmap, showCrimeMap, heatmapData, crimeHeatmapData]);

  // Sync active marker icon when selectedListingId changes (browse mode only)
  useEffect(() => {
    if (!isActive || heroMode) return;
    const map = mapRef.current;
    if (!map?.markers) return;
    map.markers.forEach((marker) => {
      const img = marker.getElement().querySelector("img");
      if (!img) return;
      img.src = marker._listingId === selectedListingId
        ? `/assets/map-icons/map-${marker._starRating}-a.svg`
        : `/assets/map-icons/map-${marker._starRating}.svg`;
    });
  }, [isActive, selectedListingId]);

  // Toggle handlers that preserve the current camera (center, zoom, pitch, bearing)
  const handleToggleHeatmap = useCallback(() => {
    const map = mapRef.current;
    const center = map ? [map.getCenter().lng, map.getCenter().lat] : null;
    const zoom = map ? map.getZoom() : null;
    const pitch = map ? map.getPitch() : null;
    const bearing = map ? map.getBearing() : null;

    setShowHeatmap((v) => !v);

    // Reapply camera to avoid map jumping to defaults
    if (map && center) {
      // schedule a frame so layer changes can apply but camera is restored immediately
      requestAnimationFrame(() => {
        map.jumpTo({ center, zoom, pitch, bearing });
      });
    }
  }, []);

  const handleToggleCrimeMap = useCallback(() => {
    const map = mapRef.current;
    const center = map ? [map.getCenter().lng, map.getCenter().lat] : null;
    const zoom = map ? map.getZoom() : null;
    const pitch = map ? map.getPitch() : null;
    const bearing = map ? map.getBearing() : null;

    setShowCrimeMap((v) => !v);

    if (map && center) {
      requestAnimationFrame(() => {
        map.jumpTo({ center, zoom, pitch, bearing });
      });
    }
  }, []);

  // Zoom to a searched address and show appropriate pin
  const searchHandledRef = useRef(null);
  useEffect(() => {
    if (!isActive) return;
    const map = mapRef.current;
    if (!map || !searchLocation) return;

    const process = () => {
      if (map._searchMarker) { map._searchMarker.remove(); map._searchMarker = null; }

      const { lat, lng } = searchLocation;
      const match = listings.find(
        (l) => l.latitude && l.longitude && haversineMeters(lat, lng, l.latitude, l.longitude) <= 80
      );

      if (match) {
        map.flyTo({ center: [lng, lat], zoom: 17, duration: 1000 });
        const key = `${lat},${lng}`;
        if (searchHandledRef.current !== key) {
          searchHandledRef.current = key;
          setTimeout(() => onListingSelect?.(match), 1100);
        }
      } else {
        map.flyTo({ center: [lng, lat], zoom: 16, duration: 1000 });
        const el = document.createElement("div");
        el.style.cssText = "width:14px;height:14px;background:#1a1a1a;border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:default;";
        map._searchMarker = new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      }
    };

    if (map.isStyleLoaded()) process();
    else map.once("load", process);
  }, [isActive, searchLocation, listings]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
      {heroMode && (
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
      )}
    </div>
  );
}
