import { Pressable, View } from "react-native";
import { Heart } from "lucide-react-native";
import { colors } from "../../theme/tokens";

const ICON_SIZE = { lg: 18, xl: 20, "2xl": 24 };

// Interactive heart icon for favorites — Lucide Heart instead of the ♥/♡
// Unicode glyphs (design-system/MASTER.md §6). Filled state uses `primary`
// (red-600, "active/selected state" per MASTER.md §2) rather than the
// original `error` red-500 — same family, but the semantically correct
// token for a saved/active indicator. Wrapped in a fixed 44x44 hit area
// regardless of visual icon size, since the previous glyph + 8px hitSlop
// fell short of the 44x44 minimum flagged in MASTER.md §9.
export function HeartIcon({ isSaved = false, onPress, size = "xl", disabled = false }) {
  const iconSize = ICON_SIZE[size] ?? ICON_SIZE.xl;
  const icon = (
    <Heart
      size={iconSize}
      color={isSaved ? colors.primary : colors.textMuted}
      fill={isSaved ? colors.primary : "transparent"}
      strokeWidth={2}
    />
  );

  if (!onPress || disabled) {
    return <View className="items-center justify-center">{icon}</View>;
  }

  return (
    <Pressable onPress={onPress} className="items-center justify-center" style={{ minWidth: 44, minHeight: 44 }}>
      {icon}
    </Pressable>
  );
}
