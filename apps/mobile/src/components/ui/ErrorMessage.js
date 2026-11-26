import { Pressable, Text, View } from "react-native";
import { AlertCircle } from "lucide-react-native";
import { colors } from "../../theme/tokens";

// The app's one error design. Messages come from getErrorMessage (lib/apiError.js)
// or are the screen's own validation text; only the text changes.
//
//   ErrorMessage  a form- or section-level error, shown inline where the problem
//                 is (above a button, under a form, over a composer).
//   ErrorState    a screen or list that could not load: the message centred, with
//                 an optional action (Try again, Go back).
//
// Alerts for failed one-off actions go through lib/showError.js, which reuses the
// same wording.
export function ErrorMessage({ children, compact = false, className = "" }) {
  if (!children) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className={`flex-row items-start rounded-lg border border-red-200 bg-red-50 ${
        compact ? "px-3 py-2" : "px-4 py-3"
      } ${className}`}
    >
      <View style={{ marginTop: compact ? 1 : 2 }}>
        <AlertCircle size={compact ? 14 : 16} color={colors.primary} strokeWidth={2} />
      </View>
      <Text className={`flex-1 ml-2 text-red-700 ${compact ? "text-xs" : "text-sm"}`}>{children}</Text>
    </View>
  );
}

export function ErrorState({ message, onAction, actionLabel = "Try again", className = "" }) {
  return (
    <View className={`flex-1 items-center justify-center px-8 ${className}`}>
      <View className="mb-3">
        <AlertCircle size={32} color={colors.textMuted} strokeWidth={1.5} />
      </View>
      <Text accessibilityRole="alert" className="text-gray-700 text-center">
        {message}
      </Text>
      {onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8} className="mt-4">
          <Text className="text-red-600 font-semibold">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
