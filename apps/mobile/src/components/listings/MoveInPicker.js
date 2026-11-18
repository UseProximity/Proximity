// Move-in Date of the filter sheet: the website's Month and Day dropdowns, as
// two fields that each open a list (design-system/MASTER.md §11.3: dropdowns
// become sheets). Month alone means open by the end of the next such month; a
// day makes it by that day of it. The day needs a month first. onChange gets
// the fields to set: a new month drops a day it does not have, and clears the
// older moveInDate, as on the website.
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronDown } from "lucide-react-native";
import { FILTER_MONTHS, DAYS_IN_MONTH } from "@proximity/shared";
import { colors } from "../../theme/tokens";

// A dropdown-style field. Red edge while it holds a value, as on the website.
function Field({ placeholder, text, disabled, onPress, className }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Move-in ${placeholder.toLowerCase()}`}
      accessibilityValue={{ text: text || "Any" }}
      accessibilityState={{ disabled }}
      className={`${className} h-11 flex-row items-center justify-between rounded-xl border px-3 ${
        disabled ? "border-gray-200 bg-gray-50" : text ? "border-red-600 bg-white" : "border-gray-300 bg-white"
      }`}
    >
      <Text className={`text-sm ${disabled ? "text-gray-300" : text ? "text-gray-900" : "text-gray-400"}`}>
        {text || placeholder}
      </Text>
      <ChevronDown size={16} color={disabled ? colors.border : colors.textSecondary} strokeWidth={2} />
    </Pressable>
  );
}

// The list a field opens: its placeholder (no value) first, then the options
// ([value, label]); picking one closes it.
function OptionSheet({ title, options, value, onPick, onClose }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityLabel="Close" />
      <View className="bg-white rounded-t-2xl" style={{ paddingBottom: insets.bottom }}>
        <Text className="text-base font-bold text-gray-900 px-4 pt-4 pb-2">{title}</Text>
        <ScrollView className="max-h-96">
          {[["", title], ...options].map(([v, label]) => (
            <Pressable
              key={v || "none"}
              onPress={() => onPick(v)}
              accessibilityRole="button"
              accessibilityState={{ selected: v === value }}
              className="h-11 flex-row items-center justify-between px-4 border-b border-gray-100 active:bg-gray-50"
            >
              <Text className={`text-sm ${v === value ? "font-semibold text-red-600" : v ? "text-gray-900" : "text-gray-400"}`}>
                {label}
              </Text>
              {v === value ? <Check size={16} color={colors.primary} strokeWidth={2.5} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function MoveInPicker({ month, day, onChange }) {
  // Which list is open: "month", "day" or null.
  const [open, setOpen] = useState(null);
  const months = FILTER_MONTHS.map((name, i) => [String(i + 1), name]);
  const days = Array.from({ length: DAYS_IN_MONTH[(month || 1) - 1] }, (_, i) => [String(i + 1), String(i + 1)]);
  const pick = (patch) => {
    setOpen(null);
    onChange(patch);
  };
  return (
    <View className="flex-row gap-2">
      <Field
        placeholder="Month"
        text={month ? FILTER_MONTHS[month - 1] : ""}
        onPress={() => setOpen("month")}
        className="flex-[3]"
      />
      <Field placeholder="Day" text={day} disabled={!month} onPress={() => setOpen("day")} className="flex-[2]" />
      {open === "month" ? (
        <OptionSheet
          title="Month"
          options={months}
          value={month || ""}
          onClose={() => setOpen(null)}
          onPick={(m) =>
            pick({
              moveInMonth: m,
              moveInDate: "",
              moveInDay: m && Number(day) <= DAYS_IN_MONTH[m - 1] ? day : "",
            })
          }
        />
      ) : null}
      {open === "day" ? (
        <OptionSheet
          title="Day"
          options={days}
          value={day || ""}
          onClose={() => setOpen(null)}
          onPick={(d) => pick({ moveInDay: d })}
        />
      ) : null}
    </View>
  );
}
