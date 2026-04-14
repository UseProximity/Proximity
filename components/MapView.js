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
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showExplore, setShowExplore] = useState(false);
  const [showBrowseButton, setShowBrowseButton] = useState(false);
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

    const PIN_PATH = "M2.10342 24.897C4.01562 32.1187 12.8496 42.2217 17.49 47.001C22.6189 42.2217 30.6445 31.1218 32.8766 24.897C35.6237 17.2363 34.3335 1.67745 17.4901 1.00098C1.36353 1.67745 -0.827361 17.1308 2.10342 24.897Z";
    const STAR_PATH = "M17.0293 8.79004C17.1878 8.34883 17.8122 8.34883 17.9707 8.79004L20.4404 15.668C20.6507 16.2534 21.2013 16.6479 21.8232 16.6602L29.2773 16.8076C29.7553 16.817 29.9486 17.427 29.5635 17.71L23.6768 22.0293C23.1599 22.4086 22.9415 23.0747 23.1328 23.6865L25.2832 30.5664C25.4241 31.0173 24.9192 31.3935 24.5273 31.1299L18.3379 26.9619C17.8315 26.621 17.1685 26.621 16.6621 26.9619L10.4727 31.1299C10.0808 31.3935 9.57593 31.0173 9.7168 30.5664L11.8672 23.6865C12.0585 23.0747 11.8401 22.4086 11.3232 22.0293L5.43652 17.71C5.05135 17.427 5.24468 16.817 5.72266 16.8076L13.1768 16.6602C13.7987 16.6479 14.3493 16.2534 14.5596 15.668L17.0293 8.79004Z";

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
    const sortedListings = [...listings].sort((a, b) => b.latitude - a.latitude);

    sortedListings.forEach((listing) => {
      if (!listing.longitude || !listing.latitude) return;

      const exactRating = (listing.rating || 0) > 0 ? (listing.rating || 0) : null;
      const markerEl = buildPinSVGElement(exactRating, listing._id, false);
      markerEl.style.cursor = onListingSelect ? "pointer" : "default";
      const marker = new mapboxgl.Marker({ element: markerEl, anchor: "bottom" })
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

  // Keep listingsRef current so the selectedListingId effect can find coordinates
  useEffect(() => { listingsRef.current = listings; }, [listings]);

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
      const newPin = buildPinSVGElement(marker._rating, marker._listingId, isActive);
      el.innerHTML = newPin.innerHTML;
    });

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

  // Zoom to a searched address and show a dot marker
  useEffect(() => {
    if (!isActive) return;
    const map = mapRef.current;
    if (!map || !searchLocation) return;

    const process = () => {
      if (map._searchMarker) { map._searchMarker.remove(); map._searchMarker = null; }

      const { lat, lng } = searchLocation;

      // Select the listing if one exists at this address, otherwise show a dot
      const R = 6371000;
      const haversine = (la1, ln1, la2, ln2) => {
        const dLat = (la2 - la1) * Math.PI / 180;
        const dLng = (ln2 - ln1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };
      const match = listings.find(
        (l) => l.latitude && l.longitude && haversine(lat, lng, l.latitude, l.longitude) <= 80
      );

      if (match) {
        onListingSelect?.(match);
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
      {!heroMode && onBrowseArea && (
        <div
          className="absolute top-3 left-1/2 z-10 transition-all duration-300"
          style={{
            opacity: showBrowseButton ? 1 : 0,
            transform: `translateX(-50%) translateY(${showBrowseButton ? "0" : "-8px"})`,
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
