// Free-text input for the open_text question kind ("Anything else…").
import { useState } from "react";
import { TextInput, View } from "react-native";
import { Chip } from "../ui/Chip";
import { SendButton } from "../ui/SendButton";

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
      <Chip tone="muted" onPress={onSkip}>
        I&apos;m all set
      </Chip>
      <SendButton onPress={() => text.trim() && onSend(text.trim())} disabled={!text.trim()} />
    </View>
  );
}
