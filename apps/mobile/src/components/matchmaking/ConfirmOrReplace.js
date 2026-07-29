// "Is your name X, or something else?" control for the confirm_or_replace
// kind (only ever the first question, name_confirm).
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

export function ConfirmOrReplace({ currentName, onConfirm }) {
  const [name, setName] = useState("");

  const send = () => {
    if (name.trim()) onConfirm(name.trim());
  };

  return (
    <View className="flex-row items-center gap-2">
      {!!currentName && (
        <Pressable onPress={() => onConfirm(currentName, "Yes, that's me")} className="px-3 py-1.5 rounded-full bg-white border border-red-300">
          <Text className="text-red-700 text-sm font-medium">Yes, that&apos;s me</Text>
        </Pressable>
      )}
      <TextInput
        placeholder="Or type a name…"
        value={name}
        onChangeText={setName}
        onSubmitEditing={send}
        className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2"
      />
      <Pressable onPress={send} disabled={!name.trim()} className={`w-9 h-9 rounded-full items-center justify-center ${name.trim() ? "bg-red-600" : "bg-red-200"}`}>
        <Text className="text-white font-bold">→</Text>
      </Pressable>
    </View>
  );
}
