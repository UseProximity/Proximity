// Find Your Place, page 2: one open text box, with prompts underneath for
// ideas. Same rules as the website (apps/web/src/components/findYourPlace/
// StepPreferences.js): the box is the answer, and picking an idea writes its
// sentence into it. A picked idea leaves its row; a prompt whose ideas exclude
// each other (furnishing) goes once one is picked, and also offers "No
// Preference". Deleting or rewording a sentence brings its picks back. Three
// untouched prompts show at a time.
import { Pressable, Text, TextInput, View } from "react-native";
import { PROMPTS, PROMPTS_AT_ONCE, NO_PICK, TEXT_MAX, applyChipToText, standingChips } from "@proximity/shared";
import { Chip } from "../ui/Chip";
import { colors } from "../../theme/tokens";

export function StepPreferences({ text, chips, onChange, onSkip }) {
  // A prompt's picks only count while its sentence still stands in the box.
  const standing = standingChips(text, chips);
  const picked = (prompt) => (standing[prompt.id] ?? []).filter((id) => id !== NO_PICK);

  const pick = (prompt, optionId) => {
    const before = picked(prompt);
    const after = prompt.single ? [optionId] : [...before, optionId];
    onChange({
      chips: { ...chips, [prompt.id]: after },
      text: applyChipToText(text, prompt, before, after),
    });
  };

  // Each prompt with the ideas it still has to offer; prompts with none are done.
  const open = PROMPTS.map((prompt) => {
    const taken = picked(prompt);
    const dismissed = (chips[prompt.id] ?? []).includes(NO_PICK);
    const done = dismissed || (prompt.single && taken.length > 0);
    const left = done ? [] : prompt.options.filter((o) => !taken.includes(o.id));
    return {
      prompt,
      // A multi-answer prompt the student has already picked from.
      started: !prompt.single && taken.length > 0,
      left,
    };
  }).filter((row) => row.left.length);

  // A multi-answer prompt that has a pick stays with what it has left, but stops
  // counting toward the three, so its first pick brings in the next prompt.
  let fresh = 0;
  const visible = open.filter((row) => row.started || fresh++ < PROMPTS_AT_ONCE);

  return (
    <View>
      <View className="flex-row items-start justify-between gap-4">
        <Text className="flex-1 text-[15px] font-semibold text-gray-900">What else would you like to see in your place?</Text>
        <Pressable
          onPress={onSkip}
          accessibilityRole="button"
          className="h-8 px-3.5 rounded-full bg-gray-100 items-center justify-center active:bg-gray-200"
        >
          <Text className="text-xs font-medium text-gray-700">Skip</Text>
        </Pressable>
      </View>

      <TextInput
        value={text}
        onChangeText={(v) => onChange({ text: v.slice(0, TEXT_MAX) })}
        maxLength={TEXT_MAX}
        multiline
        placeholder="Tell us anything..."
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="What else would you like to see in your place?"
        textAlignVertical="top"
        className="mt-3 min-h-[120px] max-h-[240px] rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm leading-5 text-gray-800"
      />

      <View className="mt-3">
        {visible.map(({ prompt, left }, i) => (
          <View key={prompt.id} className={`py-2 ${i > 0 ? "border-t border-gray-100" : ""}`}>
            <Text className="text-sm font-medium text-gray-700 mb-2">{prompt.label}:</Text>
            <View className="flex-row flex-wrap">
              {left.map((o) => (
                <Chip key={o.id} onPress={() => pick(prompt, o.id)}>
                  {o.label}
                </Chip>
              ))}
              {prompt.single && (
                <Chip tone="muted" onPress={() => onChange({ chips: { ...chips, [prompt.id]: [NO_PICK] } })}>
                  No Preference
                </Chip>
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
