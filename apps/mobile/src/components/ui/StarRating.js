import { View } from "react-native";
import { Star } from "lucide-react-native";

// Lucide Star instead of the ★ Unicode glyph (design-system/MASTER.md §6),
// matching web's lucide-react Star. Colors unchanged (yellow-400/gray-300)
// — star ratings are a universal convention, not a brand-color context.
export function StarRating({ rating, size = "sm" }) {
  const iconSize = size === "lg" ? 20 : 14;
  return (
    <View className="flex-row items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={iconSize}
          color={star <= rating ? "#facc15" : "#d1d5db"}
          fill={star <= rating ? "#facc15" : "transparent"}
          strokeWidth={1.5}
        />
      ))}
    </View>
  );
}
