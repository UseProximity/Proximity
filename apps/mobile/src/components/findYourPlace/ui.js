// Small pieces shared by the Find Your Place pages.
import { Text, View } from "react-native";

// One question: its title, then its answers as wrapping chips.
export function Question({ title, children, onLayout }) {
  return (
    <View className="mb-5" onLayout={onLayout}>
      <Text className="text-[15px] font-medium text-gray-900 mb-2.5">{title}</Text>
      <View className="flex-row flex-wrap items-center">{children}</View>
    </View>
  );
}

// One continuous bar, no number, as on the website. `value` is 0 to 1.
export function ProgressBar({ value }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View className="h-1 rounded-full bg-gray-100 overflow-hidden" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
      <View className="h-full rounded-full bg-red-600" style={{ width: `${pct}%` }} />
    </View>
  );
}

// Pill-shaped number field classes, for the rent box and the "Other" inputs.
export const FIELD = (active) =>
  `h-10 rounded-full border bg-white px-4 text-sm font-medium ${
    active ? "border-red-600 text-red-600" : "border-gray-300 text-gray-700"
  }`;
