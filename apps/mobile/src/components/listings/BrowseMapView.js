// Browse map. Ported from apps/web/src/components/listings/MapView.js's core
// behavior (one marker per listing, no clustering, fit-bounds around campus
// excluding outliers, tap a pin to select, rating teardrop pins, rated pins
// prioritized over unrated ones when overlapping) — simplified for mobile: no
// driving-route overlay, no "Browse this area" viewport filter, no
// address-search fly-to.
//
// Markers render via a ShapeSource + SymbolLayer of pre-rasterized pin icons
// (see usePinIconAtlas) rather than one live MarkerView per listing — this
// keeps every pin fully GPU-composited and perfectly in sync with the camera
// during pan/zoom. An earlier MarkerView-per-listing version measured ~3x
// slower frame times during panning (gfxinfo: 93ms vs 31ms median frame time
// with ~40 markers on screen) because each MarkerView is a live Android view
// whose position is re-synced through the JS bridge on every camera frame.
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { computeListingMapBounds, MAP_CAMPUS_CENTER } from "@proximity/shared";
import Mapbox from "../../lib/mapbox";
import { usePinIconAtlas, ratingIconId } from "./usePinIconAtlas";
import { ShuttleStopsLayer } from "./ShuttleStopsLayer";

export function BrowseMapView({ listings }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(null);
  const [showShuttleStops, setShowShuttleStops] = useState(false);
  const [shuttleStopName, setShuttleStopName] = useState(null);
  const { images, hiddenAtlas } = usePinIconAtlas();

  const bounds = useMemo(() => computeListingMapBounds(listings), [listings]);
  const pinnable = useMemo(
    () => listings.filter((l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude)),
    [listings]
  );
  const selected = pinnable.find((l) => l._id === selectedId) ?? null;

  const shape = useMemo(
    () => ({
      type: "FeatureCollection",
      features: pinnable.map((listing) => {
        const rating = (listing.rating || 0) > 0 ? listing.rating || 0 : null;
        const isSelected = listing._id === selectedId;
        return {
          type: "Feature",
          id: listing._id,
          geometry: { type: "Point", coordinates: [listing.longitude, listing.latitude] },
          properties: {
            listingId: listing._id,
            iconId: ratingIconId(rating, isSelected),
            sortKey: isSelected ? 2 : rating != null ? 1 : 0,
          },
        };
      }),
    }),
    [pinnable, selectedId]
  );

  function handlePress(event) {
    const listingId = event.features?.[0]?.properties?.listingId;
    if (listingId) setSelectedId(listingId);
  }

  return (
    <View className="flex-1">
      {hiddenAtlas}
      <Mapbox.MapView
        style={{ flex: 1 }}
        styleURL="mapbox://styles/mapbox/streets-v11"
        surfaceView={false}
      >
        <Mapbox.Camera
          bounds={bounds ?? undefined}
          defaultSettings={{
            centerCoordinate: [MAP_CAMPUS_CENTER.longitude, MAP_CAMPUS_CENTER.latitude],
            zoomLevel: 12,
          }}
        />
        <ShuttleStopsLayer visible={showShuttleStops} onSelectStop={setShuttleStopName} />
        {images && <Mapbox.Images images={images} />}
        {images && (
          <Mapbox.ShapeSource id="listings-source" shape={shape} onPress={handlePress} hitbox={{ width: 44, height: 44 }}>
            <Mapbox.SymbolLayer
              id="listings-icons"
              style={{
                iconImage: ["get", "iconId"],
                iconAnchor: "bottom",
                iconAllowOverlap: true,
                iconSize: 1,
                symbolSortKey: ["get", "sortKey"],
              }}
            />
          </Mapbox.ShapeSource>
        )}
      </Mapbox.MapView>

      <View className="absolute top-3 right-3 flex-col gap-1.5">
        <Pressable
          onPress={() => {
            setShowShuttleStops((v) => !v);
            setShuttleStopName(null);
          }}
          className={`px-2.5 py-1.5 rounded-full shadow border ${
            showShuttleStops ? "bg-teal-500 border-teal-500" : "bg-white border-gray-200"
          }`}
        >
          <Text className={`text-[11px] font-medium ${showShuttleStops ? "text-white" : "text-gray-700"}`}>
            {showShuttleStops ? "Hide Shuttle stops" : "Show Shuttle stops"}
          </Text>
        </Pressable>
      </View>

      {showShuttleStops && shuttleStopName && (
        <View className="absolute top-14 left-0 right-0 items-center">
          <View className="bg-gray-900/90 rounded-full px-3 py-1.5">
            <Text className="text-white text-xs font-semibold">{shuttleStopName}</Text>
          </View>
        </View>
      )}

      {selected && (
        <Pressable
          onPress={() => router.push(`/listings/${selected._id}`)}
          className="absolute bottom-4 left-4 right-4 bg-white rounded-2xl border border-gray-100 p-3 flex-row items-center justify-between"
          style={{ elevation: 4, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8 }}
        >
          <View className="flex-1 min-w-0 mr-2">
            <Text numberOfLines={1} className="font-bold text-gray-900 text-sm">
              {selected.title || selected.address}
            </Text>
            <Text numberOfLines={1} className="text-xs text-gray-500 mt-0.5">
              {selected.address}
            </Text>
          </View>
          <Text className="text-red-600 text-xs font-semibold">View →</Text>
        </Pressable>
      )}
    </View>
  );
}
