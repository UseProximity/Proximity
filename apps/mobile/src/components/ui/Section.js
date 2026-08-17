import { Text, View } from "react-native";

// Titled group of form fields, generalized from the local Section component
// already used in FilterSheet.js — reusable across Add Listing's wizard steps.
export function Section({ title, children, className = "" }) {
  return (
    <View className={`mb-6 ${className}`}>
      {title ? <Text className="text-base font-bold text-gray-900 mb-2">{title}</Text> : null}
      {children}
    </View>
  );
}
