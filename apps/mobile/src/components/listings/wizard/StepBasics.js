// Screen 2: what kind of place. Chips and toggles only — the availability
// ask costs one tap ("Available now" is pre-selected) but is deliberate:
// matchmaking needs a move-in signal on every listing. Mirrors
// apps/web/src/components/listings/wizard/StepBasics.js. The date field is a
// plain YYYY-MM-DD text input, matching FilterSheet.js's existing
// moveInDate precedent — no date-picker library installed.
import { TextInput, View } from "react-native";
import { HOME_TYPES } from "@proximity/shared";
import { Chip } from "../../ui/Chip";
import { FieldLabel, StepFrame } from "./wizardShared";

export default function StepBasics({ w }) {
  return (
    <StepFrame title="What kind of place is it?" subtitle="No wrong answers. You can change any of this later.">
      <View className="flex-row flex-wrap">
        {HOME_TYPES.map((t) => (
          <Chip key={t} on={w.form.home_type === t} onPress={() => w.setField("home_type", t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Chip>
        ))}
      </View>

      <View className="mt-4">
        <FieldLabel>Anything students should know?</FieldLabel>
        <View className="flex-row flex-wrap">
          <Chip on={w.form.furnished} onPress={() => w.setField("furnished", !w.form.furnished)}>
            Furnished
          </Chip>
          <Chip on={w.form.sublease_friendly} onPress={() => w.setField("sublease_friendly", !w.form.sublease_friendly)}>
            Sublease friendly
          </Chip>
          <Chip on={w.form.twenty_one_plus} onPress={() => w.setField("twenty_one_plus", !w.form.twenty_one_plus)}>
            21+ only
          </Chip>
        </View>
      </View>

      <View className="mt-4">
        <FieldLabel>When is it available?</FieldLabel>
        <View className="flex-row flex-wrap items-center">
          <Chip
            on={w.availabilityMode === "now"}
            onPress={() => {
              w.setAvailabilityMode("now");
              w.setField("move_in_date", "");
            }}
          >
            Available now
          </Chip>
          <Chip on={w.availabilityMode === "date"} onPress={() => w.setAvailabilityMode("date")}>
            From a date
          </Chip>
          {w.availabilityMode === "date" ? (
            <TextInput
              value={w.form.move_in_date}
              onChangeText={(v) => w.setField("move_in_date", v)}
              placeholder="YYYY-MM-DD"
              autoFocus
              placeholderTextColor="#9ca3af"
              className="h-11 w-32 border border-gray-200 rounded-xl px-3 text-sm text-gray-900 bg-gray-50"
            />
          ) : null}
        </View>
      </View>
    </StepFrame>
  );
}
