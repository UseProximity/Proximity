// Single-pick chip row for question kinds "choice", "yesno_pref",
// "month_select", and "tradeoff": tapping a chip submits immediately (no
// separate send button), matching apps/web/src/components/matchmaking/AnswerControls.js.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Chip } from "../ui/Chip";
import { SendButton } from "../ui/SendButton";

export function ChoiceChips({ options, allowOther, expandCount, unsureLabel, onPick, onUnsure }) {
  const [otherMode, setOtherMode] = useState(false);
  const [text, setText] = useState("");
  // Floor of an open-ended "N+" chip (e.g. 5) on an expandCount question: swaps the
  // chips for a fewest/most headcount pair, submitted as "6" or "5-7" (as on web).
  const [countFloor, setCountFloor] = useState(null);
  const [count, setCount] = useState("");
  const [countMax, setCountMax] = useState("");

  if (countFloor != null) {
    const lo = parseInt(count, 10);
    const hi = parseInt(countMax, 10);
    const valid = Number.isFinite(lo) && Number.isFinite(hi) && lo >= countFloor && hi >= lo;
    const sendCount = () => valid && onPick(lo === hi ? String(lo) : `${lo}-${hi}`);
    return (
      <View className="flex-row items-center gap-2">
        <TextInput
          autoFocus
          keyboardType="number-pad"
          placeholder={`At least ${countFloor}`}
          value={count}
          onChangeText={setCount}
          className="w-24 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2"
        />
        <Text className="text-sm text-gray-500">to</Text>
        <TextInput
          keyboardType="number-pad"
          placeholder="At most"
          value={countMax}
          onChangeText={setCountMax}
          onSubmitEditing={sendCount}
          className="w-24 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2"
        />
        <Chip tone="muted" onPress={() => setCountFloor(null)}>
          Back
        </Chip>
        <SendButton onPress={sendCount} disabled={!valid} className="ml-auto" />
      </View>
    );
  }

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
      {options.map((opt) => {
        const floor = expandCount && /^\d+\+$/.test(opt) ? parseInt(opt, 10) : null;
        return (
          <Chip key={opt} tone="unselected" onPress={() => (floor != null ? setCountFloor(floor) : onPick(opt))}>
            {opt}
          </Chip>
        );
      })}
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
