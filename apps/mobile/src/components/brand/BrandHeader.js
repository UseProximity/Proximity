import { Text, View } from "react-native";
import { BrandMark } from "./BrandMark";

// Branding block at the top of the login and signup screens: the plain logo mark
// (no rings; those belong to the logged-out feature screens), the
// "Proximity" wordmark set like the web header's (bold, tight tracking) and the
// tagline. Replaces the old plain-text wordmark.
export function BrandHeader({ compact = false }) {
  return (
    <View className="items-center">
      <BrandMark size={compact ? 52 : 64} rings={0} />
      <Text
        accessibilityRole="header"
        className={`font-bold tracking-tight text-gray-900 ${compact ? "text-2xl mt-1" : "text-[30px] mt-2"}`}
      >
        Proximity
      </Text>
      <Text className="text-[15px] text-gray-500 text-center mt-1">
        Find your perfect place near campus.
      </Text>
    </View>
  );
}
