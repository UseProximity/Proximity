// Numeric input for the budget_max question kind.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

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
      <Pressable onPress={onUnsure} className="px-3 py-1.5 rounded-full bg-gray-100 border border-gray-300">
        <Text className="text-gray-500 text-sm font-medium">No Preference</Text>
      </Pressable>
      <Pressable
        onPress={() => value && onSend(value)}
        disabled={!value}
        className={`ml-auto w-9 h-9 rounded-full items-center justify-center ${value ? "bg-red-600" : "bg-red-200"}`}
      >
        <Text className="text-white font-bold">→</Text>
      </Pressable>
    </View>
  );
}
