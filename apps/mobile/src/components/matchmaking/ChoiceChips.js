// Single-pick chip row for question kinds "choice", "yesno_pref",
// "month_select", and "tradeoff" — tapping a chip submits immediately (no
// separate send button), matching apps/web/src/components/matchmaking/AnswerControls.js.
import { useState } from "react";
import { TextInput, View } from "react-native";
import { Chip } from "../ui/Chip";
import { SendButton } from "../ui/SendButton";

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
        <Chip tone="muted" onPress={() => setOtherMode(false)}>
          Back
        </Chip>
        <SendButton onPress={() => text.trim() && onPick(text.trim())} disabled={!text.trim()} />
      </View>
    );
  }

  return (
    <View className="flex-row flex-wrap">
      {options.map((opt) => (
        <Chip key={opt} tone="unselected" onPress={() => onPick(opt)}>
          {opt}
        </Chip>
      ))}
      {allowOther && (
        <Chip tone="unselected" onPress={() => setOtherMode(true)}>
          Something else…
        </Chip>
      )}
      {onUnsure && (
        <Chip tone="muted" onPress={onUnsure}>
          {unsureLabel ?? "No Preference"}
        </Chip>
      )}
    </View>
  );
}
