// Single-pick chip row for question kinds "choice", "yesno_pref",
// "month_select", and "tradeoff" — tapping a chip submits immediately (no
// separate send button), matching apps/web/src/components/matchmaking/AnswerControls.js.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

export function ChoiceChips({ options, allowOther, unsureLabel, onPick, onUnsure }) {
  const [otherMode, setOtherMode] = useState(false);
  const [text, setText] = useState("");

  if (otherMode) {
    return (
      <View className="flex-row items-center gap-2">
        <TextInput
          autoFocus
          placeholder="Type your answer…"
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => text.trim() && onPick(text.trim())}
          className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2"
        />
        <Pressable onPress={() => setOtherMode(false)} className="px-3 py-2 rounded-full bg-gray-100">
          <Text className="text-xs font-medium text-gray-500">Back</Text>
        </Pressable>
        <Pressable
          onPress={() => text.trim() && onPick(text.trim())}
          disabled={!text.trim()}
          className={`w-9 h-9 rounded-full items-center justify-center ${text.trim() ? "bg-red-600" : "bg-red-200"}`}
        >
          <Text className="text-white font-bold">→</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((opt) => (
        <Pressable key={opt} onPress={() => onPick(opt)} className="px-3 py-1.5 rounded-full bg-white border border-red-300">
          <Text className="text-red-700 text-sm font-medium">{opt}</Text>
        </Pressable>
      ))}
      {allowOther && (
        <Pressable onPress={() => setOtherMode(true)} className="px-3 py-1.5 rounded-full bg-white border border-red-300">
          <Text className="text-red-700 text-sm font-medium">Something else…</Text>
        </Pressable>
      )}
      {onUnsure && (
        <Pressable onPress={onUnsure} className="px-3 py-1.5 rounded-full bg-gray-100 border border-gray-300">
          <Text className="text-gray-500 text-sm font-medium">{unsureLabel ?? "No Preference"}</Text>
        </Pressable>
      )}
    </View>
  );
}
