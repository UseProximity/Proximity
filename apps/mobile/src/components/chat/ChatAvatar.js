import { Image, Text, View } from "react-native";

// Round avatar: the person's photo when there is one, otherwise their initial.
export function ChatAvatar({ name, image, size = 44 }) {
  const initial = (name ?? "").trim().charAt(0).toUpperCase() || "?";
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  if (image) {
    return <Image source={{ uri: image }} style={dimension} className="bg-gray-100" />;
  }
  return (
    <View style={dimension} className="bg-red-100 items-center justify-center">
      <Text className="text-red-600 font-bold" style={{ fontSize: size * 0.4 }}>
        {initial}
      </Text>
    </View>
  );
}
