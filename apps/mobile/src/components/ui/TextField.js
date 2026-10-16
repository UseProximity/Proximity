import { Text, TextInput, View } from "react-native";

// Canonical text input with label/error slots, matching the visual language
// already established in FilterSheet.js/ProfileCompletionModal.js (bordered,
// rounded-xl) rather than each new screen hand-rolling its own.
export function TextField({ label, error, className = "", inputClassName = "", ...inputProps }) {
  return (
    <View className={className}>
      {label ? <Text className="text-sm font-medium text-gray-700 mb-1.5">{label}</Text> : null}
      <TextInput
        className={`h-12 border rounded-xl px-4 text-base text-gray-900 bg-gray-50 ${
          error ? "border-red-400" : "border-gray-200"
        } ${inputClassName}`}
        placeholderTextColor="#9ca3af"
        {...inputProps}
      />
      {error ? <Text className="text-xs text-red-500 mt-1">{error}</Text> : null}
    </View>
  );
}
