import { ActivityIndicator, Pressable, Text } from "react-native";
import { colors } from "../../theme/tokens";

const VARIANTS = {
  primary: "bg-red-600 active:bg-red-700",
  secondary: "bg-white border border-gray-200 active:bg-gray-50",
  ghost: "bg-transparent active:bg-gray-50",
};

const TEXT_VARIANTS = {
  primary: "text-white",
  secondary: "text-gray-900",
  ghost: "text-red-600",
};

const SIZES = {
  md: "h-12 px-4",
  lg: "h-14 px-5",
};

const SPINNER_COLOR = {
  primary: colors.white,
  secondary: colors.textPrimary,
  ghost: colors.primary,
};

// Canonical primary/secondary/ghost button, matching web's actual brand color
// (bg-red-600 — see apps/web/src/components/ui/Button.js's default variant)
// rather than the gray-900 used ad hoc in a few older mobile screens.
export function Button({
  children,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  className = "",
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      className={`rounded-xl items-center justify-center ${VARIANTS[variant]} ${SIZES[size]} ${
        isDisabled ? "opacity-50" : ""
      } ${className}`}
    >
      {loading ? (
        <ActivityIndicator color={SPINNER_COLOR[variant]} />
      ) : (
        <Text className={`text-base font-semibold ${TEXT_VARIANTS[variant]}`}>{children}</Text>
      )}
    </Pressable>
  );
}
