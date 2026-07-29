// Free-text input for the open_text question kind ("Anything else…").
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

export function OpenTextInput({ placeholder, onSend, onSkip }) {
  const [text, setText] = useState("");

  return (
    <View className="flex-row items-center gap-2">
      <TextInput
        placeholder={placeholder || "Type anything…"}
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => text.trim() && onSend(text.trim())}
        className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2"
      />
      <Pressable onPress={onSkip} className="px-3 py-1.5 rounded-full bg-gray-100 border border-gray-300">
        <Text className="text-gray-500 text-sm font-medium">I&apos;m all set</Text>
      </Pressable>
      <Pressable
        onPress={() => text.trim() && onSend(text.trim())}
        disabled={!text.trim()}
        className={`w-9 h-9 rounded-full items-center justify-center ${text.trim() ? "bg-red-600" : "bg-red-200"}`}
      >
        <Text className="text-white font-bold">→</Text>
      </Pressable>
    </View>
  );
}
