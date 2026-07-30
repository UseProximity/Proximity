import { Pressable, Text } from "react-native";

// Interactive heart icon for favorites.
// Shows filled (♥) if saved, outline (♡) if not.
export function HeartIcon({ isSaved = false, onPress, size = "xl", disabled = false }) {
  const color = isSaved ? "text-red-500" : "text-gray-400";
  const sizeClass = size === "lg" ? "text-lg" : size === "xl" ? "text-xl" : "text-2xl";
  
  if (!onPress || disabled) {
    // Non-interactive mode
    return (
      <Text className={`${color} ${sizeClass} leading-none`}>
        {isSaved ? "♥" : "♡"}
      </Text>
    );
  }

  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text className={`${color} ${sizeClass} leading-none`}>
        {isSaved ? "♥" : "♡"}
      </Text>
    </Pressable>
  );
}
