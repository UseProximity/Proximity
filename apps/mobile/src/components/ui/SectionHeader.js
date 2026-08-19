import { Text, View } from "react-native";
import { colors } from "../../theme/tokens";

// Small icon-badged section header — the app's consistent "this is a
// distinct section" marker (design-system Stage I visual-polish pass).
// Shared between FilterSheet's grouped clusters and Listing Detail's
// section headers rather than each screen hand-rolling its own.
export function SectionHeader({ icon: Icon, title, subtitle }) {
  return (
    <View className="flex-row items-center gap-2 mb-3">
      <View className="w-7 h-7 rounded-full bg-red-100 items-center justify-center">
        <Icon size={14} color={colors.primary} strokeWidth={2.5} />
      </View>
      <View className="flex-1">
        <Text className="text-base font-bold text-gray-900">{title}</Text>
        {subtitle ? <Text className="text-xs text-gray-500">{subtitle}</Text> : null}
      </View>
    </View>
  );
}
