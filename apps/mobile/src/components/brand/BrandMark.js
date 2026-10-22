import { View } from "react-native";
import { ProximityLogoMark } from "../icons/ProximityLogoMark";

// Shared logo treatment for the logged-out and sign-in screens. The mark is the
// same one the web header renders (apps/web/public/logo.svg, ported in
// ProximityLogoMark); the soft concentric rings behind it echo the name, a
// place with things close around it. Rings are plain Views, so no new
// dependency. Ring diameters depend on `size`, hence the inline width/height.
const RING_FILLS = ["bg-red-50", "bg-red-50/70", "bg-red-50/40"];

export function BrandMark({ size = 64, rings = 2 }) {
  const step = size * 0.5;
  const outer = size + step * 2 * rings;
  const diameters = [];
  for (let i = rings; i >= 1; i--) diameters.push(i);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Proximity logo"
      className="items-center justify-center"
      style={{ width: outer, height: outer }}
    >
      {diameters.map((i) => (
        <View
          key={i}
          className={`absolute rounded-full border border-red-100/80 ${RING_FILLS[i - 1] ?? RING_FILLS[2]}`}
          style={{ width: size + step * 2 * i, height: size + step * 2 * i }}
        />
      ))}
      <ProximityLogoMark size={size} />
    </View>
  );
}
