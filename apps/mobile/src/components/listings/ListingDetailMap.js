// Single-listing map. Ported from apps/web/src/components/listings/
// ListingMap.js — a simple pin at a fixed zoom. Web also shows a text
// Popup with the address; skipped here since the address is already shown
// above the map in the Detail screen's own layout.
import { View } from "react-native";
import Mapbox from "../../lib/mapbox";
import { colors } from "../../theme/tokens";

export function ListingDetailMap({ latitude, longitude }) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return (
    <View className="h-48 rounded-2xl overflow-hidden border border-gray-100">
      <Mapbox.MapView
        style={{ flex: 1 }}
        styleURL="mapbox://styles/mapbox/streets-v11"
        surfaceView={false}
      >
        <Mapbox.Camera centerCoordinate={[longitude, latitude]} zoomLevel={15} />
        <Mapbox.MarkerView id="listing-location" coordinate={[longitude, latitude]}>
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 999,
              backgroundColor: colors.primary,
              borderWidth: 2,
              borderColor: colors.white,
            }}
          />
        </Mapbox.MarkerView>
      </Mapbox.MapView>
    </View>
  );
}
