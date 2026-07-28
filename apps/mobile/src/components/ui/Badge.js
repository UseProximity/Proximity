import { View, Text } from "react-native";

const VARIANTS = {
  default: "bg-red-600",
  secondary: "bg-gray-100",
  outline: "bg-white border border-gray-200",
};

const TEXT_VARIANTS = {
  default: "text-white",
  secondary: "text-gray-900",
  outline: "text-gray-900",
};

export function Badge({ children, variant = "default", className = "" }) {
  return (
    <View className={`self-start rounded-full px-2.5 py-1 ${VARIANTS[variant]} ${className}`}>
      <Text className={`text-xs font-semibold ${TEXT_VARIANTS[variant]}`}>{children}</Text>
    </View>
  );
}
