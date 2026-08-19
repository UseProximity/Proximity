// Multi-select chip row for question kinds "multi" and "contact" — toggle any
// number of chips, then tap Send. "multi" also allows typing a custom option;
// "contact" (allowOther=false) offers only the given options plus an escape.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Chip } from "../ui/Chip";
import { SendButton } from "../ui/SendButton";

export function MultiChoiceChips({ options, allowOther, escapeLabel, onSend, onEscape }) {
  const [selected, setSelected] = useState([]);
  const [otherMode, setOtherMode] = useState(false);
  const [text, setText] = useState("");

  const toggle = (opt) => setSelected((cur) => (cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt]));
  const customSelected = selected.filter((s) => !options.includes(s));

  const addCustom = () => {
    const t = text.trim();
    if (t && !selected.includes(t)) setSelected((cur) => [...cur, t]);
    setText("");
  };

  const send = () => {
    const t = text.trim();
    const next = t && !selected.includes(t) ? [...selected, t] : selected;
    if (next.length) onSend(next);
  };

  const canSend = selected.length > 0 || !!text.trim();

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center">
        {options.map((opt) => (
          <Chip key={opt} on={selected.includes(opt)} onPress={() => toggle(opt)}>
            {opt}
          </Chip>
        ))}
        {customSelected.map((opt) => (
          <Chip key={opt} tone="selected" onPress={() => toggle(opt)} onRemove={() => toggle(opt)}>
            {opt}
          </Chip>
        ))}
        {allowOther && (
          <Chip tone="unselected" onPress={() => setOtherMode((v) => !v)}>
            Other…
          </Chip>
        )}
        {escapeLabel && (
          <Chip tone="muted" onPress={onEscape}>
            {escapeLabel}
          </Chip>
        )}
      </View>

      {otherMode && (
        <View className="flex-row items-center gap-2">
          <TextInput
            autoFocus
            placeholder="Add your own…"
            value={text}
            onChangeText={setText}
            onSubmitEditing={addCustom}
            className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2"
          />
          <Pressable onPress={addCustom} disabled={!text.trim()} className="px-3 py-2 rounded-full bg-gray-100">
            <Text className="text-xs font-medium text-gray-700">Add</Text>
          </Pressable>
        </View>
      )}

      <SendButton onPress={send} disabled={!canSend} className="self-end" />
    </View>
  );
}
