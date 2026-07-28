import { View, Text } from "react-native";

// No icon library installed (see ListingCard/HeartIcon) — unicode stars
// instead of lucide-react's Star icon used on web.
export function StarRating({ rating, size = "sm" }) {
  const fontSize = size === "lg" ? 20 : 14;
  return (
    <View className="flex-row items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Text
          key={star}
          style={{ fontSize, lineHeight: fontSize + 2 }}
          className={star <= rating ? "text-yellow-400" : "text-gray-300"}
        >
          ★
        </Text>
      ))}
    </View>
  );
}
