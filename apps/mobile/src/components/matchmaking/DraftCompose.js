// Editable email draft shown after the user opts to contact a listing's
// owner(s). Ported behavior from web's DraftCompose: live-editable textarea,
// locks to a read-only "Sent" state once sent.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

export function DraftCompose({ draft, onSend }) {
  const [message, setMessage] = useState(draft.message);

  if (draft.sent) {
    return (
      <View className="mt-2 bg-white border border-gray-200 rounded-xl p-3">
        <Text className="text-xs text-gray-500 italic">{draft.message}</Text>
        <Text className="text-[11px] text-green-600 font-semibold mt-2">Sent ✓</Text>
      </View>
    );
  }

  return (
    <View className="mt-2 bg-white border border-gray-200 rounded-xl p-3 gap-2">
      <TextInput
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        className="text-sm text-gray-800 min-h-[80px]"
      />
      <Pressable
        onPress={() => onSend(draft, message)}
        disabled={!message.trim()}
        className={`self-end px-4 py-2 rounded-full ${message.trim() ? "bg-red-600" : "bg-red-200"}`}
      >
        <Text className="text-white text-sm font-semibold">Send</Text>
      </Pressable>
    </View>
  );
}
