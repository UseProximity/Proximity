import { Text } from "react-native";

// Decorative only — no favorites backend exists yet (deferred to Phase 6,
// once auth is in place). Renders a static outline heart; not pressable.
export function HeartIcon() {
  return <Text className="text-gray-400 text-xl leading-none">♡</Text>;
}
