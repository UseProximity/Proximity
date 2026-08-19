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
//
// `onImage` (opt-in, default off — the Listing Detail header's heart on a
// plain white bar is unaffected) is for contexts like ListingCard's photo
// overlay and the Listing Detail hero, where the icon sits directly on a
// photo with no background container at all. Both states share a thick
// white stroke — legible against any photo without needing a circle behind
// it — so only fill communicates saved vs. unsaved: solid `primary` when
// saved, a semi-transparent black (~35%) when not, so the underlying photo
// still shows through the heart's interior rather than reading as a flat
// dark shape.
export function HeartIcon({ isSaved = false, onPress, size = "xl", disabled = false, onImage = false }) {
  const iconSize = ICON_SIZE[size] ?? ICON_SIZE.xl;
  const icon = (
    <Heart
      size={iconSize}
      color={onImage ? colors.white : isSaved ? colors.primary : colors.textMuted}
      fill={isSaved ? colors.primary : onImage ? "rgba(0, 0, 0, 0.35)" : "transparent"}
      strokeWidth={onImage ? 3 : 2}
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
