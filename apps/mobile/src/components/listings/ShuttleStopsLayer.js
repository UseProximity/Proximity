// Optional shuttle-stop overlay for the Browse map. Ported from web's
// MapView.js addShuttleStops/removeShuttleStops (teal circle layer, tap a
// stop to see its name) — toggled via the "Show/Hide Shuttle stops" button.
// Renders only the map layer; the parent renders the name label overlay
// outside the MapView (ShapeSource/CircleLayer must be direct MapView children).
import { SHUTTLE_STOPS } from "@proximity/shared";
import Mapbox from "../../lib/mapbox";

const shape = {
  type: "FeatureCollection",
  features: SHUTTLE_STOPS.map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    properties: { name: s.name },
  })),
};

export function ShuttleStopsLayer({ visible, onSelectStop }) {
  if (!visible) return null;

  return (
    <Mapbox.ShapeSource
      id="shuttle-stops-source"
      shape={shape}
      onPress={(event) => onSelectStop?.(event.features?.[0]?.properties?.name ?? null)}
      hitbox={{ width: 24, height: 24 }}
    >
      <Mapbox.CircleLayer
        id="shuttle-stops-layer"
        style={{
          circleRadius: 4,
          circleColor: "#14b8a6",
          circleStrokeWidth: 1.5,
          circleStrokeColor: "#ffffff",
          circleOpacity: 0.85,
        }}
      />
    </Mapbox.ShapeSource>
  );
}
