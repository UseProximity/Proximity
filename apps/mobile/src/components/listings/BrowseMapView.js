// Browse map. Ported from apps/web/src/components/listings/MapView.js: flat
// pins (grey when unavailable, a gold badge when suggested, a star filled by
// rating), nearby pins grouped into one numbered pin that a tap zooms into,
// groups merging and splitting with motion as the zoom changes, the selected
// pin drawn larger and never grouped, listings at the same spot set side by
// side at high zoom, the more southern pin drawn on top, and the initial fit
// around campus. Simplified for mobile: no driving-route overlay, no "Browse
// this area" viewport filter, no address-search fly-to, no "Hide unavailable"
// control (the list/map toggle covers it).
//
// Markers render via a ShapeSource + SymbolLayer of pre-rendered pin icons
// (static PNGs, see pinIcons) rather than one live MarkerView per listing: this
// keeps every pin fully GPU-composited and perfectly in sync with the camera
// during pan/zoom. An earlier MarkerView-per-listing version measured ~3x
// slower frame times during panning (gfxinfo: 93ms vs 31ms median frame time
// with ~40 markers on screen) because each MarkerView is a live Android view
// whose position is re-synced through the JS bridge on every camera frame.
// The grouping is computed in JS (web's rules, see mapPinGroups) and only
// redrawn when a zoom change actually regroups the pins.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { MAP_CAMPUS_CENTER } from "@proximity/shared";
import Mapbox from "../../lib/mapbox";
import {
  CLUSTER_MAX_ZOOM,
  CLUSTER_ZOOM_STEP,
  clusterListings,
  fitCamera,
  pinFlyZoom,
  worldPoint,
} from "../../lib/mapPinGroups";
import { PIN_ICON_IMAGES, PIN_LAYER_STYLE, clusterIconId, pinFeature, pinIconId } from "./pinIcons";
import { PinMotionLayer, pinTransition } from "./PinMotionLayer";
import { ShuttleStopsLayer } from "./ShuttleStopsLayer";
import { colors, shadows } from "../../theme/tokens";

// The one shadow tier design-system/MASTER.md §5 allows, reserved for
// floating elements lifted off the map surface (this screen's toggle pill
// and selected-listing preview card).
const FLOATING_SHADOW = shadows.floating;

// Mapbox logo and attribution "i" offsets. The clearance is the selected-listing
// card's height (about 62) plus its 16 bottom offset, with a little breathing room.
const ORNAMENT_MARGIN = 8;
const SELECTED_CARD_CLEARANCE = 88;

const INITIAL_ZOOM = 12;
const DEFAULT_CAMERA = {
  centerCoordinate: [MAP_CAMPUS_CENTER.longitude, MAP_CAMPUS_CENTER.latitude],
  zoomLevel: INITIAL_ZOOM,
};
const NO_PADDING = { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 };
// The pin you picked keeps its design and is drawn larger (web's
// SELECTED_PIN_SCALE), and sits above every other pin.
const SELECTED_PIN_SCALE = 1.3;
const TOP_SORT_KEY = 20000000;
// Height of a pin's body centre above its tip, used to find the pin nearest a tap.
const PIN_BODY_CENTER = 27;

// The pins for one zoom, with everything that decides how each one looks,
// following web's renderPins. A group is grey only when every listing in it
// is unavailable, and has the suggested badge when any listing in it is
// suggested. `key` changes whenever the pin's listings or look change.
function buildPins(listings, zoom, selectedId, suggestedIds) {
  return clusterListings(listings, zoom, selectedId).map(({ members, lng, lat, dx }) => {
    const isCluster = members.length > 1;
    const listing = members[0];
    const isSelected = !isCluster && listing._id === selectedId;
    const rating = (listing.rating || 0) > 0 ? listing.rating : null;
    const allUnavailable = members.every((l) => l.unavailable);
    const anySuggested = members.some((l) => suggestedIds.has(String(l._id)));
    const look = `${allUnavailable}:${anySuggested}:${dx}`;
    const count = members.length;
    return {
      key: isCluster ? `${members.map((l) => l._id).join(",")}:${look}` : `${listing._id}:${isSelected}:${rating}:${look}`,
      members,
      lng,
      lat,
      dx,
      isCluster,
      size: isSelected ? SELECTED_PIN_SCALE : 1,
      iconId: isCluster ? clusterIconId(allUnavailable, anySuggested) : pinIconId(rating, allUnavailable, anySuggested),
      // Web's count sizes: 20pt, shrinking for longer counts.
      label: isCluster ? String(count) : "",
      textSize: !isCluster ? 1 : count > 99 ? 12 : count > 9 ? 16 : 20,
      // Southern pins on top of northern ones (web's pinZIndex), single or
      // grouped alike; only the selected pin sits above them all.
      sortKey: isSelected ? TOP_SORT_KEY : Math.round((90 - lat) * 100000),
    };
  });
}

const sameKeys = (a, b) => a.length === b.length && a.every((pin, i) => pin.key === b[i].key);

export function BrowseMapView({ listings, suggestedIds }) {
  const router = useRouter();
  const cameraRef = useRef(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showShuttleStops, setShowShuttleStops] = useState(false);
  const [shuttleStopName, setShuttleStopName] = useState(null);
  const [mapSize, setMapSize] = useState(null);

  const pinnable = useMemo(
    () => listings.filter((l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude)),
    [listings]
  );
  const selected = pinnable.find((l) => l._id === selectedId) ?? null;
  // Mapbox's logo and attribution "i" (the telemetry opt-in) sit at the bottom
  // corners. Lift them clear of the selected-listing card so they stay visible
  // and tappable while it is open.
  const ornamentBottom = selected ? SELECTED_CARD_CLEARANCE : ORNAMENT_MARGIN;

  // Fit when the SET of listings changes, as web does: keyed on the ids, so a
  // new array holding the same listings leaves the camera where it is.
  const fitKey = useMemo(() => pinnable.map((l) => String(l._id)).sort().join(","), [pinnable]);
  const fit = useMemo(
    () => (mapSize && pinnable.length > 0 ? fitCamera(pinnable, mapSize.width, mapSize.height) : null),
    [fitKey, mapSize]
  );

  // Web skips the pin motion when the system asks for reduced motion.
  const reduceMotionRef = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        reduceMotionRef.current = enabled;
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      reduceMotionRef.current = enabled;
    });
    return () => sub.remove();
  }, []);

  // The pins on the map and the motion between the last two sets. Which
  // listings group depends on the zoom, so the pins are rebuilt as it changes,
  // but only a change of grouping or look reaches the map.
  const zoomRef = useRef(INITIAL_ZOOM);
  const pinsRef = useRef([]);
  const [pins, setPins] = useState([]);
  const [transition, setTransition] = useState(null);
  const endTransition = useCallback((done) => setTransition((current) => (current === done ? null : current)), []);

  function showPins(zoom) {
    const next = buildPins(pinnable, zoom, selectedId, suggestedIds);
    const prev = pinsRef.current;
    pinsRef.current = next;
    if (sameKeys(prev, next)) return;
    setPins(next);
    setTransition(reduceMotionRef.current ? null : pinTransition(prev, next, zoom));
  }

  useEffect(() => {
    showPins(zoomRef.current);
  }, [pinnable, selectedId, suggestedIds]);

  function handleCameraChanged(state) {
    const zoom = state.properties.zoom;
    if (zoom === zoomRef.current) return;
    zoomRef.current = zoom;
    showPins(zoom);
  }

  const shape = useMemo(
    () => ({
      type: "FeatureCollection",
      features: pins.filter((pin) => !transition?.hidden.has(pin.key)).map((pin) => pinFeature(pin)),
    }),
    [pins, transition]
  );

  // The hitbox can catch neighbouring pins (side-by-side pins are 26pt apart),
  // so the one whose body is nearest the tap wins.
  function handlePress(event) {
    const zoom = zoomRef.current;
    const scale = 2 ** zoom;
    const tap = worldPoint(event.coordinates.longitude, event.coordinates.latitude);
    let hit = null;
    let best = Infinity;
    for (const feature of event.features ?? []) {
      const { dx, size } = feature.properties;
      const point = worldPoint(...feature.geometry.coordinates);
      const distance = Math.hypot(
        (point.x - tap.x) * scale + dx,
        (point.y - tap.y) * scale - PIN_BODY_CENTER * size
      );
      if (distance < best) {
        best = distance;
        hit = feature;
      }
    }
    if (!hit) return;
    const centerCoordinate = hit.geometry.coordinates;
    if (hit.properties.isCluster) {
      cameraRef.current?.setCamera({
        centerCoordinate,
        zoomLevel: Math.min(CLUSTER_MAX_ZOOM, zoom + CLUSTER_ZOOM_STEP),
        padding: NO_PADDING,
        animationDuration: 600,
        animationMode: "easeTo",
      });
      return;
    }
    const { listingId } = hit.properties;
    if (listingId === selectedId) return;
    setSelectedId(listingId);
    // Fly onto the pin, as web does, placing it 20% of the map's height above
    // the centre (bottom padding of 40% moves the centre up by 20%).
    cameraRef.current?.setCamera({
      centerCoordinate,
      zoomLevel: pinFlyZoom(zoom),
      padding: { ...NO_PADDING, paddingBottom: Math.round((mapSize?.height ?? 0) * 0.4) },
      animationDuration: 700,
      animationMode: "flyTo",
    });
  }

  return (
    <View
      className="flex-1"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setMapSize((size) => (size?.width === width && size?.height === height ? size : { width, height }));
      }}
    >
      <Mapbox.MapView
        style={{ flex: 1 }}
        styleURL="mapbox://styles/mapbox/streets-v11"
        surfaceView={false}
        logoPosition={{ bottom: ornamentBottom, left: ORNAMENT_MARGIN }}
        attributionPosition={{ bottom: ornamentBottom, right: ORNAMENT_MARGIN }}
        onCameraChanged={handleCameraChanged}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={DEFAULT_CAMERA}
          centerCoordinate={fit?.center}
          zoomLevel={fit?.zoom}
          padding={fit ? NO_PADDING : undefined}
          animationDuration={1400}
          animationMode="flyTo"
        />
        <ShuttleStopsLayer visible={showShuttleStops} onSelectStop={setShuttleStopName} />
        <Mapbox.Images images={PIN_ICON_IMAGES} />
        <Mapbox.ShapeSource id="listings-source" shape={shape} onPress={handlePress} hitbox={{ width: 44, height: 44 }}>
          <Mapbox.SymbolLayer id="listings-icons" style={PIN_LAYER_STYLE} />
        </Mapbox.ShapeSource>
        <PinMotionLayer transition={transition} onDone={endTransition} />
      </Mapbox.MapView>

      <View className="absolute top-3 right-3 flex-col gap-1.5">
        <Pressable
          onPress={() => {
            setShowShuttleStops((v) => !v);
            setShuttleStopName(null);
          }}
          className={`px-2.5 py-1.5 rounded-full border ${
            showShuttleStops ? "bg-red-600 border-red-600" : "bg-white border-gray-200"
          }`}
          style={FLOATING_SHADOW}
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
          style={FLOATING_SHADOW}
        >
          <View className="flex-1 min-w-0 mr-2">
            <Text numberOfLines={1} className="font-bold text-gray-900 text-sm">
              {selected.title || selected.address}
            </Text>
            <Text numberOfLines={1} className="text-xs text-gray-500 mt-0.5">
              {selected.address}
            </Text>
          </View>
          <View className="flex-row items-center">
            <Text className="text-red-600 text-xs font-semibold">View</Text>
            <ChevronRight size={14} color={colors.primary} strokeWidth={2.5} />
          </View>
        </Pressable>
      )}
    </View>
  );
}
