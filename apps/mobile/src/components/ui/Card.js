import { View } from "react-native";

// Bordered, padded container for grouping related fields — e.g. a repeatable
// unit card in Add Listing's Units step. Radius matches the `container`
// tier (design-system/MASTER.md §4) — 16px, aligning with web's actual
// ListingCard radius (rounded-2xl) rather than the 12px `control` tier
// buttons/inputs use.
export function Card({ children, className = "" }) {
  return <View className={`bg-white rounded-2xl border border-gray-200 p-4 ${className}`}>{children}</View>;
}
