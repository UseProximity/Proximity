// Multi-select chip row for question kinds "multi" and "contact" — toggle any
// number of chips, then tap Send. "multi" also allows typing a custom option;
// "contact" (allowOther=false) offers only the given options plus an escape.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

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
      <View className="flex-row flex-wrap items-center gap-2">
        {options.map((opt) => {
          const on = selected.includes(opt);
          return (
            <Pressable
              key={opt}
              onPress={() => toggle(opt)}
              className={`px-3 py-1.5 rounded-full border ${on ? "bg-red-600 border-red-600" : "bg-white border-red-300"}`}
            >
              <Text className={`text-sm font-medium ${on ? "text-white" : "text-red-700"}`}>{opt}</Text>
            </Pressable>
          );
        })}
        {customSelected.map((opt) => (
          <Pressable key={opt} onPress={() => toggle(opt)} className="px-3 py-1.5 rounded-full bg-red-600 border border-red-600">
            <Text className="text-white text-sm font-medium">{opt} ✕</Text>
          </Pressable>
        ))}
        {allowOther && (
          <Pressable onPress={() => setOtherMode((v) => !v)} className="px-3 py-1.5 rounded-full bg-white border border-red-300">
            <Text className="text-red-700 text-sm font-medium">Other…</Text>
          </Pressable>
        )}
        {escapeLabel && (
          <Pressable onPress={onEscape} className="px-3 py-1.5 rounded-full bg-gray-100 border border-gray-300">
            <Text className="text-gray-500 text-sm font-medium">{escapeLabel}</Text>
          </Pressable>
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

      <Pressable
        onPress={send}
        disabled={!canSend}
        className={`self-end w-9 h-9 rounded-full items-center justify-center ${canSend ? "bg-red-600" : "bg-red-200"}`}
      >
        <Text className="text-white font-bold">→</Text>
      </Pressable>
    </View>
  );
}
