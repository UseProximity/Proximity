import { Pressable, Text } from "react-native";
import { Check, X } from "lucide-react-native";

// Canonical pill/chip control — promoted from
// src/components/listings/wizard/wizardShared.js (design-system/pages/
// add-listing.md) since FilterSheet.js and 5 matchmaking components each
// hand-roll a near-duplicate pill Pressable. `tone` covers the 3 states
// found in practice: selected/unselected (the original two-state shape,
// still reachable via the `on` boolean for backward compatibility) and
// muted (the "No preference"/"I'm all set" escape-hatch style used across
// matchmaking's question components). `onRemove` renders an inline close
// icon for removable custom tags (e.g. MultiChoiceChips' typed-in options).
// `showCheck` (opt-in, default off — every existing caller is unaffected)
// prefixes a small checkmark when selected, for contexts like FilterSheet
// where the selected state should be unambiguous at a glance, not just a
// color change. `icon` (opt-in, a component reference) prefixes a small
// recognition icon instead — for option sets where one genuinely helps
// (amenities, utilities), not decoration on every chip everywhere. Not
// designed to combine with `showCheck` in the same chip (the icon itself
// already marks what the chip represents; layering a checkmark on top of
// it reads as clutter, not extra clarity) — callers should pick one.
const TONE_STYLES = {
  selected: { container: "bg-red-600 border-red-600", text: "text-white", icon: "#ffffff" },
  unselected: { container: "bg-white border-gray-300", text: "text-gray-700", icon: "#6b7280" },
  muted: { container: "bg-gray-100 border-gray-300", text: "text-gray-500", icon: "#6b7280" },
};

export function Chip({ on, tone, children, onPress, onRemove, showCheck = false, icon: Icon = null }) {
  const resolvedTone = tone ?? (on ? "selected" : "unselected");
  const { container, text, icon: iconColor } = TONE_STYLES[resolvedTone];
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center px-3.5 py-2 rounded-full border mr-2 mb-2 ${container}`}
    >
      {Icon ? <Icon size={14} color={iconColor} strokeWidth={2} style={{ marginRight: 5 }} /> : null}
      {showCheck && resolvedTone === "selected" ? (
        <Check size={14} color="#ffffff" strokeWidth={3} style={{ marginRight: 5 }} />
      ) : null}
      <Text className={`text-sm font-medium ${text}`}>{children}</Text>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} className="ml-1.5">
          <X size={14} color={resolvedTone === "selected" ? "#ffffff" : "#6b7280"} strokeWidth={2.5} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}
