import { Pressable } from "react-native";
import { ArrowUp } from "lucide-react-native";
import { colors, shadows } from "../../theme/tokens";

// Floating brand-red "back to top" circle shared by Browse and the listing detail page.
// The parent decides when to render it; `bottom` lets a screen lift it above a
// safe-area inset.
export function BackToTopButton({ onPress, bottom = 16 }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Back to top"
      hitSlop={8}
      className="absolute right-4 w-11 h-11 rounded-full bg-red-600 active:bg-red-700 items-center justify-center"
      style={[shadows.floating, { bottom }]}
    >
      <ArrowUp size={18} color={colors.white} strokeWidth={2} />
    </Pressable>
  );
}
