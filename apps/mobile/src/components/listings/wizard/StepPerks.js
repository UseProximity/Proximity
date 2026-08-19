// Screen 4: amenities + included utilities. All chips, all optional.
// Mirrors apps/web/src/components/listings/wizard/StepPerks.js.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { AMENITY_OPTIONS, AMENITY_LABELS, UTILITY_OPTIONS, UTILITY_LABELS } from "@proximity/shared";
import { Chip } from "../../ui/Chip";
import { FieldLabel, StepFrame } from "./wizardShared";

export default function StepPerks({ w }) {
  const [customInput, setCustomInput] = useState("");

  const addCustom = () => {
    w.addCustomAmenity(customInput);
    setCustomInput("");
  };

  return (
    <StepFrame title="What does it come with?" subtitle="Tap everything that applies. Skip anything you're not sure about.">
      <View className="flex-row flex-wrap">
        {AMENITY_OPTIONS.map((a) => (
          <Chip key={a} on={w.form.amenities.includes(a)} onPress={() => w.toggleMulti("amenities", a)}>
            {AMENITY_LABELS[a]}
          </Chip>
        ))}
        {w.customAmenities.map((a) => (
          <Chip key={a} on onPress={() => w.removeCustomAmenity(a)} onRemove={() => w.removeCustomAmenity(a)}>
            {a}
          </Chip>
        ))}
      </View>

      <View className="flex-row items-center gap-2 mt-1">
        <TextInput
          value={customInput}
          onChangeText={setCustomInput}
          onSubmitEditing={addCustom}
          placeholder="Something else? Type and submit"
          placeholderTextColor="#9ca3af"
          className="flex-1 h-11 rounded-full border border-gray-300 px-3.5 text-sm"
        />
        {customInput.trim() ? (
          <Pressable onPress={addCustom} className="rounded-full bg-red-600 px-3.5 py-2.5">
            <Text className="text-xs font-medium text-white">Add</Text>
          </Pressable>
        ) : null}
      </View>

      <View className="mt-6">
        <FieldLabel>Utilities included in rent</FieldLabel>
        <View className="flex-row flex-wrap">
          {UTILITY_OPTIONS.map((u) => (
            <Chip key={u} on={w.form.utilities_included.includes(u)} onPress={() => w.toggleMulti("utilities_included", u)}>
              {UTILITY_LABELS[u]}
            </Chip>
          ))}
        </View>
      </View>
    </StepFrame>
  );
}
