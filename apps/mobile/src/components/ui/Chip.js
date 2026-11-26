import { Pressable, Text } from "react-native";
import { Check } from "lucide-react-native";

// Canonical pill/chip control, shared by FilterSheet.js and Find Your Place so
// none of them hand-rolls its own pill Pressable. `tone` covers the states found
// in practice: selected/unselected (also reachable via the `on` boolean), muted
// (the grey "No Preference" chip) and suggested (switched off, but something the
// student mentioned in Find Your Place: a dashed red edge and a "+ ", as on the
// website's filter panel).
// `showCheck` (opt-in, default off) prefixes a small checkmark when selected, for
// contexts like FilterSheet where the selected state should be unambiguous at a
// glance, not just a color change. `icon` (opt-in, a component reference)
// prefixes a small recognition icon instead, for option sets where one genuinely
// helps (amenities, utilities), not decoration on every chip everywhere. Not
// designed to combine with `showCheck` in the same chip (the icon itself already
// marks what the chip represents; layering a checkmark on top of it reads as
// clutter, not extra clarity); callers should pick one.
const TONE_STYLES = {
  selected: { container: "bg-red-600 border-red-600", text: "text-white", icon: "#ffffff" },
  unselected: { container: "bg-white border-gray-300", text: "text-gray-700", icon: "#6b7280" },
  muted: { container: "bg-gray-100 border-gray-300", text: "text-gray-500", icon: "#6b7280" },
  suggested: { container: "bg-white border-red-600 border-dashed", text: "text-red-600", icon: "#dc2626" },
};

export function Chip({ on, tone, children, onPress, showCheck = false, icon: Icon = null }) {
  const resolvedTone = tone ?? (on ? "selected" : "unselected");
  const { container, text, icon: iconColor } = TONE_STYLES[resolvedTone];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: resolvedTone === "selected" }}
      accessibilityHint={resolvedTone === "suggested" ? "You mentioned this in Find Your Place" : undefined}
      className={`flex-row items-center px-3.5 py-2 rounded-full border mr-2 mb-2 ${container}`}
    >
      {Icon ? <Icon size={14} color={iconColor} strokeWidth={2} style={{ marginRight: 5 }} /> : null}
      {showCheck && resolvedTone === "selected" ? (
        <Check size={14} color="#ffffff" strokeWidth={3} style={{ marginRight: 5 }} />
      ) : null}
      <Text className={`text-sm font-medium ${text}`}>
        {resolvedTone === "suggested" ? "+ " : ""}
        {children}
      </Text>
    </Pressable>
  );
}
