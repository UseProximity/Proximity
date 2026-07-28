// Rasterizes ListingMapPin's SVG variants once into static PNGs, registered as
// Mapbox style images for a SymbolLayer. Static, GPU-composited symbols move
// perfectly in sync with the map during pan/zoom, unlike MarkerView's live
// Android views (which round-trip position updates through the JS bridge every
// frame — measured ~3x slower frame times with ~40 markers on screen).
// Ratings are bucketed to the nearest RATING_STEP so a fixed, small set of
// icons can be pre-rendered instead of one per exact (continuous) rating value.
import { useEffect, useRef, useState } from "react";
import { PixelRatio, View } from "react-native";
import { ListingMapPin } from "./ListingMapPin";

const RATING_STEP = 0.25;
const RATING_BUCKETS = Array.from({ length: Math.round(5 / RATING_STEP) + 1 }, (_, i) => i * RATING_STEP);

export function ratingIconId(rating, isActive) {
  const bucket = rating == null ? "none" : (Math.round(rating / RATING_STEP) * RATING_STEP).toFixed(2);
  return `pin-${bucket}-${isActive ? "active" : "inactive"}`;
}

const ICON_VARIANTS = [
  { rating: null, isActive: false },
  { rating: null, isActive: true },
  ...RATING_BUCKETS.flatMap((rating) => [
    { rating, isActive: false },
    { rating, isActive: true },
  ]),
];

export function usePinIconAtlas() {
  const [images, setImages] = useState(null);
  const refs = useRef({});

  useEffect(() => {
    let cancelled = false;
    const collected = {};
    let remaining = ICON_VARIANTS.length;

    ICON_VARIANTS.forEach((variant) => {
      const id = ratingIconId(variant.rating, variant.isActive);
      refs.current[id]?.toDataURL((base64) => {
        // toDataURL rasterizes at the device's pixel ratio (e.g. a 35x49 Svg
        // becomes a ~92x129px PNG on a 2.625x-density screen). Mapbox images
        // registered as a bare uri string are drawn at their raw pixel size —
        // without `scale`, the icon renders ~2.6x too big on that screen.
        collected[id] = { uri: `data:image/png;base64,${base64}`, scale: PixelRatio.get() };
        remaining -= 1;
        if (remaining === 0 && !cancelled) setImages(collected);
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const hiddenAtlas = (
    <View pointerEvents="none" style={{ position: "absolute", top: -1000, left: -1000 }}>
      {ICON_VARIANTS.map((variant) => {
        const id = ratingIconId(variant.rating, variant.isActive);
        return (
          <ListingMapPin
            key={id}
            uid={id}
            ref={(r) => {
              refs.current[id] = r;
            }}
            rating={variant.rating}
            isActive={variant.isActive}
          />
        );
      })}
    </View>
  );

  return { images, hiddenAtlas };
}
