import { Text } from "react-native";

// Small uppercase sub-label for a labeled group within a card/section —
// promoted from FilterSheet.js's local component since Listing Detail's
// Amenities/Utilities split needed the identical pattern.
export function FieldLabel({ children }) {
  return <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{children}</Text>;
}
