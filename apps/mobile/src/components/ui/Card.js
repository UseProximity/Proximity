import { View } from "react-native";

// Bordered, padded container for grouping related fields — e.g. a repeatable
// unit card in Add Listing's Units step.
export function Card({ children, className = "" }) {
  return <View className={`bg-white rounded-xl border border-gray-200 p-4 ${className}`}>{children}</View>;
}
