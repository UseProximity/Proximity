// Numeric input for the budget_max question kind.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Chip } from "../ui/Chip";
import { SendButton } from "../ui/SendButton";

export function BudgetInput({ maxLabel, onSend, onUnsure }) {
  const [value, setValue] = useState("");

  return (
    <View className="flex-row items-center gap-2">
      <Text className="text-gray-400 text-sm">$</Text>
      <TextInput
        placeholder={maxLabel ?? "Max /mo"}
        value={value}
        onChangeText={setValue}
        keyboardType="number-pad"
        onSubmitEditing={() => value && onSend(value)}
        className="w-28 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2"
      />
      <Chip tone="muted" onPress={onUnsure}>
        No Preference
      </Chip>
      <SendButton onPress={() => value && onSend(value)} disabled={!value} className="ml-auto" />
    </View>
  );
}
