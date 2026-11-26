import Mapbox from "@rnmapbox/maps";

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? null);

// Mapbox usage telemetry is switched off at startup (the privacy policy says so).
Mapbox.setTelemetryEnabled(false);

export default Mapbox;
