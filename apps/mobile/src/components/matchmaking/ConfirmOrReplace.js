// "Is your name X, or something else?" control for the confirm_or_replace
// kind (only ever the first question, name_confirm).
import { useState } from "react";
import { TextInput, View } from "react-native";
import { Chip } from "../ui/Chip";
import { SendButton } from "../ui/SendButton";

export function ConfirmOrReplace({ currentName, onConfirm }) {
  const [name, setName] = useState("");

  const send = () => {
    if (name.trim()) onConfirm(name.trim());
  };

  return (
    <View className="flex-row items-center gap-2">
      {!!currentName && (
        <Chip tone="unselected" onPress={() => onConfirm(currentName, "Yes, that's me")}>
          Yes, that&apos;s me
        </Chip>
      )}
      <TextInput
        placeholder="Or type a name…"
        value={name}
        onChangeText={setName}
        onSubmitEditing={send}
        className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2"
      />
      <SendButton onPress={send} disabled={!name.trim()} />
    </View>
  );
}
